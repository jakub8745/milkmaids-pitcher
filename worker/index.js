const PINATA_FILE_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

function withCors(headers = {}) {
  return {
    ...headers,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: withCors()
      });
    }

    if (!env.PINATA_JWT) {
      return new Response("Missing PINATA_JWT secret", {
        status: 500,
        headers: withCors()
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "");

    let target;
    if (pathname.endsWith("/pinFile")) {
      target = PINATA_FILE_ENDPOINT;
    } else if (pathname.endsWith("/pinJSON")) {
      target = PINATA_JSON_ENDPOINT;
    } else {
      return new Response("Not Found", { status: 404, headers: withCors() });
    }

    const headers = new Headers();
    headers.set("Authorization", `Bearer ${env.PINATA_JWT}`);
    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }

    const response = await fetch(target, {
      method: "POST",
      headers,
      body: request.body
    });

    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    if (responseType) {
      responseHeaders.set("content-type", responseType);
    }

    return new Response(response.body, {
      status: response.status,
      headers: withCors(Object.fromEntries(responseHeaders))
    });
  }
};
