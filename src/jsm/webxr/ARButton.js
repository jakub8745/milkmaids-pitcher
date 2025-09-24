class ARButton {
  static createButton(renderer, sessionInit = {}) {
    const button = document.createElement("button");

    function showStartAR(/*device*/) {
      if (sessionInit.domOverlay === undefined) {
        const overlay = document.createElement("div");
        overlay.id = "aroverlay";
        overlay.style.display = "none";
        document.body.appendChild(overlay);

        const ARdownloadButton = document.createElement("button");
        ARdownloadButton.innerText = "get a 3D model";
        ARdownloadButton.id = "ARdownloadButton";
        overlay.appendChild(ARdownloadButton);

        //    <div id="output"></div>
        const overlayOutput = document.createElement("div");
        overlayOutput.innerText = "";
        overlayOutput.id = "overlayOutput";
        overlay.appendChild(overlayOutput);

        if (sessionInit.optionalFeatures === undefined) {
          sessionInit.optionalFeatures = [];
        }

        sessionInit.optionalFeatures.push("dom-overlay");
        sessionInit.domOverlay = { root: overlay };
      }

      //

      let currentSession = null;

      async function onSessionStarted(session) {
        session.addEventListener("end", onSessionEnded);

        renderer.xr.setReferenceSpaceType("local");

        await renderer.xr.setSession(session);

        button.textContent = "STOP AR";
        sessionInit.domOverlay.root.style.display = "";

        currentSession = session;
      }

      function onSessionEnded(/*event*/) {
        currentSession.removeEventListener("end", onSessionEnded);

        window.location.reload();
        button.textContent = "START AR";
        sessionInit.domOverlay.root.style.display = "none";

        currentSession = null;
      }

      //

      button.style.display = "";

      button.style.cursor = "pointer";
      button.style.left = "calc(80% - 75px)";
      button.style.width = "100px";

      button.textContent = "START AR";

      button.onmouseenter = function () {
        button.style.opacity = "1.0";
      };

      button.onmouseleave = function () {
        button.style.opacity = "0.5";
      };

      button.onclick = function () {
        if (currentSession === null) {
          navigator.xr
            .requestSession("immersive-ar", sessionInit)
            .then(onSessionStarted);
        } else {
          currentSession.end();
        }
      };
    }

    function disableButton() {
      button.style.display = "";

      button.style.cursor = "auto";
      button.style.left = "calc(50% - 75px)";
      button.style.width = "150px";

      button.onmouseenter = null;
      button.onmouseleave = null;

      button.onclick = null;
    }

    function showARNotSupported() {
      disableButton();

      button.textContent = "AR NOT SUPPORTED";
    }

    function showARNotAllowed(exception) {
      disableButton();

      console.warn(
        "Exception when trying to call xr.isSessionSupported",
        exception
      );

      button.textContent = "AR NOT ALLOWED";
    }

    function stylizeElement(element) {
      element.style.position = "absolute";
      element.style.bottom = "calc(13% - 30px)";
      element.style.padding = "12px 6px";
      element.style.border = "1px solid #fff";
      element.style.borderRadius = "4px";
      element.style.background = "rgba(0,0,0,0.1)";
      element.style.color = "#fff";
      element.style.font = "normal 13px sans-serif";
      element.style.textAlign = "center";
      element.style.opacity = "0.9";
      element.style.outline = "none";
      element.style.zIndex = "100009";
      element.style.left = "calc(50% - 75px)";
    }

    if ("xr" in navigator) {
      button.id = "ARButton";
      console.log("xr in navi display none?");
      button.style.display = "none";

      stylizeElement(button);

      navigator.xr
        .isSessionSupported("immersive-ar")
        .then(function (supported) {
          supported ? showStartAR() : showARNotSupported();
        })
        .catch(showARNotAllowed);

      return button;
    } else {
      const message = document.createElement("a");

      if (window.isSecureContext === false) {
        message.href = document.location.href.replace(/^http:/, "https:");
        message.innerHTML = "WEBXR NEEDS HTTPS"; // TODO Improve message
      } else {
        message.href = "https://immersiveweb.dev/";
        message.innerHTML = "WEBXR NOT AVAILABLE";
      }

      message.style.left = "calc(50% - 90px)";
      message.style.width = "180px";
      message.style.textDecoration = "none";

      stylizeElement(message);

      return message;
    }
  }
}

export { ARButton };
