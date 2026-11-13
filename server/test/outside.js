// Stand-ins for ORCID, ROR and Sender, so the tests never reach the internet.
export const ORCID_SUB = "0000-0002-1825-0097";

export async function fakeOutside(request) {
  const url = new URL(request.url);
  const host = url.hostname;
  const j = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  if (host === "orcid.org") {
    if (url.pathname === "/.well-known/openid-configuration")
      return j({
        issuer: "https://orcid.org",
        authorization_endpoint: "https://orcid.org/oauth/authorize",
        token_endpoint: "https://orcid.org/oauth/token",
        userinfo_endpoint: "https://orcid.org/oauth/userinfo",
        jwks_uri: "https://orcid.org/oauth/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"]
      });
    if (url.pathname === "/oauth/token") {
      const body = await request.text();
      if (!body.includes("code=good-code")) return j({ error: "invalid_grant" }, 400);
      return j({ access_token: "orcid-access", token_type: "bearer", expires_in: 3600, scope: "openid", orcid: ORCID_SUB, name: "Ada Test" });
    }
    if (url.pathname === "/oauth/userinfo") {
      if (request.headers.get("Authorization") !== "Bearer orcid-access") return j({ error: "unauthorized" }, 401);
      return j({ sub: ORCID_SUB, name: "Ada Test", given_name: "Ada", family_name: "Test" });
    }
  }
  if (host === "api.ror.org") {
    if (url.pathname === "/v2/organizations") {
      return j({
        items: [
          {
            id: "https://ror.org/0107c5v14",
            names: [{ value: "University of Genoa", types: ["ror_display", "label"] }],
            locations: [{ geonames_details: { country_code: "IT", country_name: "Italy", name: "Genoa" } }]
          }
        ]
      });
    }
    if (url.pathname === "/v2/organizations/0107c5v14")
      return j({
        id: "https://ror.org/0107c5v14",
        names: [{ value: "University of Genoa", types: ["ror_display", "label"] }],
        locations: [{ geonames_details: { country_code: "IT", country_name: "Italy", name: "Genoa" } }]
      });
    return j({ errors: ["not found"] }, 404);
  }
  if (host === "api.sender.net") {
    globalThis.__senderCalls = (globalThis.__senderCalls || 0) + 1;
    return j({ success: true, data: {} });
  }
  return new Response("blocked in tests: " + host, { status: 599 });
}
