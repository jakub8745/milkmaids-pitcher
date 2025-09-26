export const handler = async (event) => {
  try {
    const pinataJwt =
      process.env.PINATA_JWT ||
      Array.from({ length: 10 })
        .map((_, idx) => process.env[`PINATA_JWT_PART${idx + 1}`])
        .filter(Boolean)
        .join("");

    if (!pinataJwt) {
      return {
        statusCode: 500,
        body:
          "Missing Pinata JWT. Set PINATA_JWT or PINATA_JWT_PART* in your environment."
      };
    }

    // Parse browser payload
    const { fileName, fileContent, metadata, captureTimestamp, extraKeyValues } =
      JSON.parse(event.body || "{}");

    if (!fileName || !fileContent) {
      return { statusCode: 400, body: "Missing payload" };
    }

    // Turn the base64 string back into a Buffer
    const blobBuffer = Buffer.from(fileContent, "base64");

    const pinataMetadata = {
      name: metadata?.name ?? fileName,
      keyvalues: {
        asset_filename: fileName,
        capture_time: captureTimestamp,
        ...extraKeyValues
      }
    };

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([blobBuffer]),
      fileName
    );
    formData.append("pinataMetadata", JSON.stringify(pinataMetadata));
    formData.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pinataJwt}`
      },
      body: formData
    });

    if (!response.ok) {
      const msg = await response.text();
      return { statusCode: response.status, body: msg };
    }

    const result = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error) {
    return { statusCode: 500, body: error.message ?? "Unknown error" };
  }
};
