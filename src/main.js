import "./main.css";

import * as THREE from "three";
import { ARButton } from "./jsm/webxr/ARButton.js";
import { ArcballControls } from "three/examples/jsm/controls/ArcballControls.js";
import { GLTFLoader } from "./jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "./jsm/exporters/GLTFExporter.js";
import { DRACOLoader } from "./jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "./jsm/libs/meshopt_decoder.module.js";
import { MeshSurfaceSampler } from "./jsm/math/MeshSurfaceSampler.js";
import {
  Brush,
  Evaluator,
  //ADDITION              // A ∪ B
  SUBTRACTION, // A - B 1
  REVERSE_SUBTRACTION, // B - A 2
  DIFFERENCE, // A ⊕ B 3
  INTERSECTION // A ∩ B
} from "three-bvh-csg";
//import html2canvas from "https://cdn.skypack.dev/html2canvas";

const params = {
  operation: 3,
  wireframe: false,
  displayBrushes: false,
  shadows: true,
  useGroups: true,

  randomize: () => {
    updateCSG();
  }
};

const PINATA_UPLOAD_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const PINATA_JWT =
  import.meta.env.VITE_PINATA_JWT ||
  Array.from({ length: 10 })
    .map((_, idx) => import.meta.env[`VITE_PINATA_JWT_PART${idx + 1}`])
    .filter(Boolean)
    .join("");
const PROJECT_URL = "https://pitcher.bluepointart.uk/";

let geo;

let node;
let renderer;
let camera;
let scene;
let outputContainer;
let pitcherBrush;
let brush;
let surfaceSampler;
let resultObject;
let result;
let controls;
const csgEvaluator = new Evaluator();
let isAR = false;
let outputEl;
const gltfparams = {
  trs: false,
  onlyVisible: false,
  binary: true,
  maxTextureSize: 1024
};

let isFrozen = false;
let freezeDepth = 0;
let controlsState = null;
const snapshotReleaseStack = [];

function getCaptureTimestamp() {
  return new Date().toISOString();
}

async function getLocation(metadata) {
  if (!navigator.geolocation) {
    return;
  }

  showMessage(`> getting your location`);

  const options = {
    enableHighAccuracy: true,
    timeout: 5000,
    maximumAge: 0
  };

  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const crd = pos.coords;
        metadata.attributes.push({
          trait_type: "Latitude",
          value: crd.latitude
        });
        metadata.attributes.push({
          trait_type: "Longitude",
          value: crd.longitude
        });
        resolve();
      },
      (err) => {
        console.warn(`ERROR(${err.code}): ${err.message}`);
        resolve();
      },
      options
    );
  });
}

csgEvaluator.attributes = ["position", "normal"];
csgEvaluator.useGroups = true;

async function exportGLTF(input) {
  const gltfExporter = new GLTFExporter();

  const options = {
    trs: gltfparams.trs,
    onlyVisible: gltfparams.onlyVisible,
    binary: gltfparams.binary,
    maxTextureSize: gltfparams.maxTextureSize
  };
  gltfExporter.parse(
    input,
    function (resultE) {
      if (resultE instanceof ArrayBuffer) {
        saveArrayBuffer(resultE, "scene.glb");
      } else {
        const gltfText = JSON.stringify(resultE, null, 2);
        saveString(gltfText, "scene.gltf");
      }
    },
    function (error) {
      console.log("An error happened during parsing", error);
      const releaseFromStack = snapshotReleaseStack.pop();
      if (releaseFromStack) {
        releaseFromStack();
      }
    },
    options
  );
}
const link = document.createElement("a");
link.style.display = "none";
document.body.appendChild(link); // Firefox workaround, see #6594

async function showMessage(text) {
  node = document.createElement("div");
  node.id = "node";
  node.innerText = text;
  const overlayOutput = document.getElementById("overlayOutput");

  if (isAR && overlayOutput) {
    overlayOutput.appendChild(node);
  } else if (outputEl) {
    outputEl.appendChild(node);
  }
}

async function showLink(url) {
  node = document.createElement("a");
  node.id = "node-l";
  node.href = url;
  node.innerText = `> ${url}`;
  node.target = "_blank";
  const overlayOutput = document.getElementById("overlayOutput");

  if (isAR && overlayOutput) {
    overlayOutput.appendChild(node);
  } else if (outputEl) {
    outputEl.appendChild(node);
  }
}

function sanitizeTraitKey(key) {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "attribute";
}

function buildPinataMetadata(metadata, extraKeyValues = {}, overrideName = "") {
  const keyvalues = { ...extraKeyValues };
  if (Array.isArray(metadata.attributes)) {
    metadata.attributes.forEach((attribute) => {
      if (!attribute || !attribute.trait_type) {
        return;
      }
      const key = sanitizeTraitKey(attribute.trait_type);
      if (!(key in keyvalues)) {
        keyvalues[key] = String(attribute.value ?? "");
      }
    });
  }

  return {
    name: overrideName || metadata.name || "milkmaids-pitcher-snapshot",
    keyvalues
  };
}

function freezeScene() {
  freezeDepth += 1;
  if (freezeDepth === 1) {
    isFrozen = true;

    if (controls) {
      controlsState = {
        enabled: controls.enabled,
        autoRotate:
          typeof controls.autoRotate === "boolean" ? controls.autoRotate : null
      };
      controls.enabled = false;
      if (typeof controls.autoRotate === "boolean") {
        controls.autoRotate = false;
      }
      controls.update();
    }
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    resumeScene();
  };
}

function resumeScene() {
  if (freezeDepth === 0) {
    return;
  }

  freezeDepth -= 1;
  if (freezeDepth > 0) {
    return;
  }

  isFrozen = false;

  if (controls && controlsState) {
    controls.enabled = controlsState.enabled;
    if (
      controlsState.autoRotate !== null &&
      typeof controls.autoRotate === "boolean"
    ) {
      controls.autoRotate = controlsState.autoRotate;
    }
    controlsState = null;
    controls.update();
  }
}

async function uploadFileToPinata(
  blob,
  filename,
  metadata,
  captureTimestamp,
  options = {}
) {
  const { extraKeyValues = {}, pinName = filename } = options;

  if (!PINATA_JWT) {
    throw new Error(
      "Missing Pinata JWT. Set VITE_PINATA_JWT or VITE_PINATA_JWT_PART* in your environment before uploading."
    );
  }

  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream"
  });

  const formData = new FormData();
  formData.append("file", file);
  formData.append(
    "pinataMetadata",
    JSON.stringify(
      buildPinataMetadata(
        metadata,
        {
          asset_filename: filename,
          content_type: file.type || inferMimeType(filename),
          capture_time: captureTimestamp,
          ...extraKeyValues
        },
        pinName
      )
    )
  );
  formData.append(
    "pinataOptions",
    JSON.stringify({
      cidVersion: 1
    })
  );

  const response = await fetch(PINATA_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  if (!json || !json.IpfsHash) {
    throw new Error("Pinata upload did not return an IpfsHash");
  }

  return json.IpfsHash;
}

function inferMimeType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".glb")) {
    return "model/gltf-binary";
  }
  if (lower.endsWith(".gltf")) {
    return "model/gltf+json";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "application/octet-stream";
}

async function captureSceneScreenshot() {
  if (!renderer || !scene || !camera) {
    return null;
  }

  const canvas = renderer.domElement;
  if (!canvas) {
    return null;
  }

  const originalBackground = scene.background;

  try {
    scene.background = null;
    renderer.render(scene, camera);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((capture) => {
        resolve(capture);
      }, "image/png");
    });

    return blob;
  } finally {
    scene.background = originalBackground;
    renderer.render(scene, camera);
  }
}

function buildMintMetadata({ baseMetadata, asset, preview }) {
  const assetUri = `ipfs://${asset.cid}`;
  const assetMimeType = asset.blob.type || inferMimeType(asset.filename);
  const attributes = Array.isArray(baseMetadata.attributes)
    ? [...baseMetadata.attributes]
    : [];

  attributes.push({
    trait_type: "Asset CID",
    value: asset.cid
  });
  attributes.push({
    trait_type: "Asset Filename",
    value: asset.filename
  });

  const files = [
    {
      uri: assetUri,
      type: assetMimeType,
      name: asset.filename
    }
  ];

  let imageUri = baseMetadata.image;

  if (preview && preview.cid) {
    const previewUri = `ipfs://${preview.cid}`;
    const previewMimeType = preview.blob?.type || inferMimeType(preview.filename);
    imageUri = previewUri;
    attributes.push({
      trait_type: "Preview CID",
      value: preview.cid
    });
    files.push({
      uri: previewUri,
      type: previewMimeType,
      name: preview.filename
    });
  }

  return {
    name: baseMetadata.name,
    description: baseMetadata.description,
    image: imageUri,
    animation_url: assetUri,
    external_url: PROJECT_URL,
    attributes,
    files
  };
}

async function uploadMetadataJsonToPinata(metadataPayload, pinName = "") {
  if (!PINATA_JWT) {
    throw new Error(
      "Missing Pinata JWT. Set VITE_PINATA_JWT or VITE_PINATA_JWT_PART* in your environment."
    );
  }

  const response = await fetch(PINATA_JSON_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      pinataMetadata: buildPinataMetadata(
        metadataPayload,
        {
          content_type: "application/json"
        },
        pinName
      ),
      pinataContent: metadataPayload
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinata metadata upload failed: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  if (!json || !json.IpfsHash) {
    throw new Error("Pinata metadata upload did not return an IpfsHash");
  }

  return json.IpfsHash;
}

async function save(blob, filename) {
  const captureTimestamp = getCaptureTimestamp();
  const captureSlug = captureTimestamp
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseName = `sherd-of-pitcher-${captureSlug}`;
  const originalExtension = filename.includes(".")
    ? filename.split(".").pop()
    : "glb";
  const extension = (originalExtension || "glb").toLowerCase();
  const assetFilename = `${baseName}.${extension}`;
  const baseMetadata = {
    name: "Milkmaid's Pitcher Snapshot",
    description:
      "A unique 3d model generated by 'Milkmaid's Pitcher' digital art installation. The pitcher is part of the 'Dystopia of Imitation' collection.",
    image:
      "ipfs://bafkreiguof3bexge6u63rdl6slzgh7qbnglee67lhbgbu5sfids6oatayq",
    attributes: [
      {
        trait_type: "Artist",
        value: "Jarek Solecki @ Dystopia of imitation"
      },
      {
        trait_type: "Capture Timestamp",
        value: captureTimestamp
      }
    ]
  };

  await getLocation(baseMetadata);

  showMessage("> preparing Pinata upload");

  if (!PINATA_JWT) {
    showMessage(
      "> Pinata token missing. Set VITE_PINATA_JWT or VITE_PINATA_JWT_PART* in your .env to enable uploads"
    );
    saveBlob(blob, assetFilename);
    const releaseFromStack = snapshotReleaseStack.pop();
    if (releaseFromStack) {
      releaseFromStack();
    }
    return;
  }

  try {
    const assetCid = await uploadFileToPinata(
      blob,
      assetFilename,
      baseMetadata,
      captureTimestamp,
      {
        pinName: assetFilename,
        extraKeyValues: {
          asset_kind: "model",
          render_mode: isAR ? "webxr" : "webgl"
        }
      }
    );
    const screenshotBlob = await captureSceneScreenshot();
    let imageCid;
    let screenshotFilename;

    if (screenshotBlob) {
      screenshotFilename = `${baseName}.png`;
      imageCid = await uploadFileToPinata(
        screenshotBlob,
        screenshotFilename,
        baseMetadata,
        captureTimestamp,
        {
          pinName: screenshotFilename,
          extraKeyValues: {
            asset_kind: "preview",
            content_type: "image/png"
          }
        }
      );
    }

    const metadataPayload = buildMintMetadata({
      baseMetadata,
      asset: {
        cid: assetCid,
        filename: assetFilename,
        blob
      },
      preview: imageCid
        ? {
            cid: imageCid,
            filename: screenshotFilename,
            blob: screenshotBlob
          }
        : null
    });

    const metadataFileName = `${baseName}.json`;
    const metadataCid = await uploadMetadataJsonToPinata(
      metadataPayload,
      metadataFileName
    );

    showMessage(`> Pinata now hosting asset ${assetCid}`);
    if (imageCid) {
      showMessage(`> Preview image pinned as ${imageCid}`);
    }
    showMessage(`> Metadata pinned as ${metadataCid}`);
    showMessage("> you can mint using the metadata URI");
    showLink(`${PINATA_GATEWAY}${metadataCid}`);
    if (imageCid) {
      showMessage(`> Preview image from Pinata gateway:`);
      showLink(`${PINATA_GATEWAY}${imageCid}`);
    }
    showMessage(`> GLB download from Pinata gateway:`);
    showLink(`${PINATA_GATEWAY}${assetCid}`);
  } catch (error) {
    console.error(error);
    showMessage("> unable to reach Pinata, downloaded snapshot locally instead");
    saveBlob(blob, assetFilename);
  } finally {
    const releaseFromStack = snapshotReleaseStack.pop();
    if (releaseFromStack) {
      releaseFromStack();
    }
  }
}

function saveString(text, filename) {
  const type = inferMimeType(filename);
  save(new Blob([text], { type }), filename);
}

function saveArrayBuffer(buffer, filename) {
  const type = inferMimeType(filename);
  save(new Blob([buffer], { type }), filename);
}

async function downloadPitcher(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const release = freezeScene();
  snapshotReleaseStack.push(release);

  csgEvaluator.useGroups = params.useGroups;
  result = csgEvaluator.evaluate(
    pitcherBrush,
    brush,
    params.operation,
    result
  );

  result.castShadow = true;
  result.receiveShadow = true;

  renderer.render(scene, camera);

  try {
    /////////////////////////////////
    // Instantiate a exporter
    exportGLTF(result);
  } catch (error) {
    console.error("Failed to export GLB", error);
    const releaseFromStack = snapshotReleaseStack.pop();
    if (releaseFromStack) {
      releaseFromStack();
    } else {
      release();
    }
  }
}

var saveFile = function (strData, filename) {
  var link = document.createElement("a");
  if (typeof link.download === "string") {
    document.body.appendChild(link); //Firefox requires the link to be in the body
    link.download = filename;
    link.href = strData;
    link.click();
    document.body.removeChild(link); //remove the link when done
  } else {
    location.replace(uri);
  }
};

function getScreenshot() {
  const canvas = document.querySelector("canvas");
  if (!canvas) {
    return;
  }
  canvas.toBlob((blob) => {
    if (blob) {
      saveBlob(blob, `screencapture-${canvas.width}x${canvas.height}.png`);
    }
  });
}
function getARScreenshot() {
  const canvas = renderer.domElement;
  if (!canvas) {
    return;
  }
  canvas.toBlob((blob) => {
    if (blob) {
      saveBlob(blob, `screencapture-${canvas.width}x${canvas.height}.png`);
    }
  });
}
const saveBlob = (function () {
  const a = document.createElement("a");
  document.body.appendChild(a);
  a.style.display = "none";
  return function saveData(blob, fileName) {
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
  };
})();

async function init() {
  outputEl = document.querySelector("#output");

  const infoSection = document.getElementById("high");
  const closeInfoButton = document.getElementById("myButton");
  const openInfoButton = document.getElementById("see-info");

  if (closeInfoButton && openInfoButton && infoSection) {
    closeInfoButton.addEventListener("click", () => {
      infoSection.style.display = "none";
      openInfoButton.style.display = "block";
    });

    openInfoButton.addEventListener("click", () => {
      infoSection.style.display = "block";
      openInfoButton.style.display = "none";
    });
  }

  const downloadButton = document.createElement("button");
  const textOnButton = document.createTextNode("get a 3D model");
  downloadButton.appendChild(textOnButton);
  document.body.appendChild(downloadButton);
  downloadButton.style.opacity = "0.5";
  downloadButton.addEventListener("pointerover", () => {
    downloadButton.style.opacity = "1";
  });
  downloadButton.addEventListener("pointerout", () => {
    downloadButton.style.opacity = "0.5";
  });
  downloadButton.addEventListener("pointerdown", downloadPitcher);
  downloadButton.id = "download-button";
  /////////////////////////////////

  showMessage("> you can take a 3D model of the object...");

  outputContainer = document.getElementById("loading");

  // renderer setup
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  //renderer.setClearColor(bgColor, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ("outputColorSpace" in renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }
  renderer.xr.enabled = true;
  renderer.domElement.id = "myCanvas";
  document.body.appendChild(renderer.domElement);

  isAR = renderer.xr.isPresenting;

  document.body.appendChild(ARButton.createButton(renderer));

  //////////////////////////////////
  const screenShotButton = document.getElementById("screenshot");
  if (screenShotButton) {
    screenShotButton.style.zIndex = "1000000";
    //screenShotButton.addEventListener("click", getScreenshot);
    screenShotButton.addEventListener("pointerdown", getScreenshot);
  }

  /////////////////////////////////

  // scene setup
  scene = new THREE.Scene();
  const texture = new THREE.TextureLoader().load(
    "/textures/landscape.jpg",
    render
  );
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;

  // lights

  const light1 = new THREE.DirectionalLight(0xffffff, 4);
  light1.position.set(0, 2, 3);
  scene.add(light1, new THREE.AmbientLight(0xb0bec5, 1));

  // camera setup
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );
  camera.position.set(0, 0, 4);
  camera.lookAt(0, 0, 0);

  controls = new ArcballControls(camera, renderer.domElement, scene);
  if (typeof controls.setGizmosVisible === "function") {
    controls.setGizmosVisible(false);
  }
  controls.enablePan = false;
  controls.minDistance = 1;
  controls.maxDistance = 10;
  controls.target.set(0, 0, 0);
  controls.update();

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  const gltf = await new GLTFLoader()
    .setDRACOLoader(dracoLoader)
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync("/models/Pitcjer2100.glb");
  const geometry = gltf.scene.children[0].geometry;

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  if (geometry.boundingBox) {
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
  }
  if (geometry) {
    outputContainer.style.display = "none";
  }

  pitcherBrush = new Brush(geometry, new THREE.MeshStandardMaterial());
  pitcherBrush.receiveShadow = true;
  pitcherBrush.rotation.x = 120 * (Math.PI / 180);
  pitcherBrush.rotation.y = 20 * (Math.PI / 180);
  pitcherBrush.rotation.z = 190 * (Math.PI / 180);

  pitcherBrush.scale.set(0.5, 0.5, 0.5);
  pitcherBrush.position.set(0, 0, 0);
  pitcherBrush.updateMatrixWorld();

  surfaceSampler = new MeshSurfaceSampler(pitcherBrush);
  surfaceSampler.build();

  pitcherBrush.material.depthFunc = THREE.AlwaysDepth;
  pitcherBrush.material.depthWrite = true;
  pitcherBrush.material.polygonOffset = true;
  pitcherBrush.material.polygonOffsetFactor = 0.1;
  pitcherBrush.material.polygonOffsetUnits = 0.1;
  pitcherBrush.material.side = THREE.DoubleSide;
  pitcherBrush.material.color.set(0xff8659);
  // add object displaying the result
  resultObject = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      roughness: 0.1,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetUnits: 1,
      polygonOffsetFactor: 1
    })
  );
  resultObject.material.transparent = false;
  resultObject.castShadow = true;
  resultObject.receiveShadow = true;
  scene.add(resultObject);

  dracoLoader.setDecoderPath("/draco/");
  const gltfbrush = await new GLTFLoader()
    .setDRACOLoader(dracoLoader)
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync("/models/fluid1300tr.glb");

  const geometrybrush = gltfbrush.scene.children[0].geometry;
  geometrybrush.computeVertexNormals();
  geometrybrush.computeBoundingBox();
  if (geometrybrush.boundingBox) {
    const center = geometrybrush.boundingBox.getCenter(new THREE.Vector3());
    geometrybrush.translate(-center.x, -center.y, -center.z);
  }

  brush = new Brush(
    geometrybrush,
    new THREE.MeshStandardMaterial({
      color: 0x00cbff, //0x80cbc4,
      opacity: 0.5,
      polygonOffset: true,
      polygonOffsetUnits: 1,
      polygonOffsetFactor: 1
    })
  );
  brush.scale.set(0.02, 0.09, 0.05);
  brush.position.set(0, 0, 0);
  brush.rotation.x = (90 * Math.PI) / 180;
  brush.updateMatrixWorld();

  renderer.xr.addEventListener("sessionstart", function () {
    if (outputEl) {
      outputEl.style.display = "none";
    }

    const arButtonElement = document.getElementById("ARButton");
    const overlayRoot = document.getElementById("aroverlay");
    if (arButtonElement && overlayRoot) {
      overlayRoot.appendChild(arButtonElement);
    }
    /*
    const overlayOutput = document.createElement("div");
    overlayOutput.id = "overlayOutput";
    overlayOutput.style = "bottom: 4em";
*/
    node = document.createElement("div");
    node.id = "node";
    //node.style = "bottom: 2em";
    node.innerText =
      "> take a 3D static snapshot of this unique scuplpture";
    const overlayOutput = document.getElementById("overlayOutput");
    if (overlayOutput) {
      overlayOutput.appendChild(node);
    }

    showMessage("> take a 3D snapshot of this unique scuplpture");
    ////
    const ARdownloadButton = document.getElementById("ARdownloadButton");

    if (ARdownloadButton) {
      ARdownloadButton.addEventListener("pointerdown", downloadPitcher);
    }

    scene.background = null;
    if (params.operation === 3) {
      params.operation = 1;
    }
    isAR = renderer.xr.isPresenting;

    updateCSG();
  });
  window.addEventListener(
    "resize",
    function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();

      renderer.setSize(window.innerWidth, window.innerHeight);
    },
    false
  );
}

async function updateCSG() {
  if (pitcherBrush && brush) {
    csgEvaluator.useGroups = params.useGroups;
    result = csgEvaluator.evaluate(
      pitcherBrush,
      brush,
      params.operation,
      result
    );

    result.castShadow = true;
    result.receiveShadow = true;
    scene.add(result);
  }
}
////////////////////////////////////////////////////////////////////////////////////

const rotatePitcher = () => {
  if (pitcherBrush) {
    const t = window.performance.now() + 9000;
    pitcherBrush.rotation.z = t * -0.0002;
    //pitcherBrush.rotation.x = t * 0.0001;
    //pitcherBrush.rotation.y = t * 0.0001;
    pitcherBrush.updateMatrixWorld();
  }
  if (brush) {
    const t = window.performance.now() + 9000;
    brush.rotation.y = t * -0.0005;
    brush.rotation.x = t * -0.0000005;
    brush.rotation.z = t * -0.00005;
    brush.updateMatrixWorld();
  }
};

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  if (!isFrozen) {
    rotatePitcher();
    updateCSG();
  }

  renderer.render(scene, camera);
}

async function start() {
  try {
    await init();
    animate();
  } catch (error) {
    console.error("Failed to initialise scene", error);
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
