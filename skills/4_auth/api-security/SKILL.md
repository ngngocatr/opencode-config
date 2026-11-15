---
name: api-sec
description: >-
  Entry P1 category router for API security. Use when choosing between API
  recon, authorization, token abuse, and hidden-parameter workflows before any
  deeper API topic skill.
when_to_use: Sử dụng skill này khi gặp các dấu hiệu liên quan đến api-security.
---

# API Security Router

This is the routing entry point for API security testing.

Use this skill first to decide whether the API issue is mostly recon/docs, object authorization, token trust, or GraphQL/hidden parameters, then route to a deeper topic skill.

## When to Use

- The target exposes REST APIs, mobile backends, or GraphQL endpoints
- You need to define API testing order before going into specific topics
- You want to handle object authorization, JWT, GraphQL, and hidden fields as separate tracks

## Skill Map

- [API Recon and Docs](../api-recon-and-docs/SKILL.md): OpenAPI, Swagger, version drift, hidden documentation
- [API Authorization and BOLA](../api-authorization-and-bola/SKILL.md): BOLA, BFLA, method abuse, hidden writable fields
- [API Auth and JWT Abuse](../api-auth-and-jwt-abuse/SKILL.md): bearer token, header trust, claim abuse, rate-limit bypass
- [GraphQL and Hidden Parameters](../graphql-and-hidden-parameters/SKILL.md): introspection, batching, undocumented fields, hidden parameters

## Quick Triage

| Observation | Route |
|---|---|
| Swagger or OpenAPI is present | [api-recon-and-docs](../api-recon-and-docs/SKILL.md) |
| IDs appear in URL, JSON, headers, or GraphQL args | [api-authorization-and-bola](../api-authorization-and-bola/SKILL.md) |
| JWT token visible in traffic | [api-auth-and-jwt-abuse](../api-auth-and-jwt-abuse/SKILL.md) |
| `/graphql` or batched JSON arrays are present | [graphql-and-hidden-parameters](../graphql-and-hidden-parameters/SKILL.md) |
| Registration, login, or profile updates accept extra fields | [api-authorization-and-bola](../api-authorization-and-bola/SKILL.md) then [api-auth-and-jwt-abuse](../api-auth-and-jwt-abuse/SKILL.md) |

## Recommended Flow

1. Start with exposed endpoints and documentation assets
2. Then evaluate object-level and function-level authorization
3. Then evaluate token, header, signature, and rate-limit boundaries
4. If GraphQL or complex JSON is present, continue with hidden fields and schema abuse

## Related Categories

- [auth-sec](../auth-sec/SKILL.md)
- [business-logic-vuln](../business-logic-vuln/SKILL.md)
- [recon-for-sec](../recon-for-sec/SKILL.md)---
name: api-authorization-and-bola
description: >-
  API authorization and BOLA testing playbook. Use when APIs expose object identifiers, nested resources, hidden writable fields, or weak function-level authorization.
---

# SKILL: API Authorization and BOLA — Object Access, Function Access, and Mass Assignment

> **AI LOAD INSTRUCTION**: Use this skill when an API exposes object IDs, nested resources, or role-sensitive functions and you need a focused authorization test path: BOLA, BFLA, method abuse, and hidden field control.

## 1. CORE TEST LOOP

1. Create Account A and Account B.
2. As Account A, capture create, read, update, and delete flows.
3. Replay with Account B's token.
4. Test sibling endpoints, nested endpoints, and alternate HTTP verbs.

## 2. TEST SURFACES

| Surface | Example |
|---|---|
| object read | `/api/v1/orders/123` |
| nested object | `/api/v1/users/1/invoices/9` |
| admin or internal function | `/api/v1/admin/users` |
| update path | `PUT`, `PATCH`, `DELETE` variants |
| hidden JSON fields | `role`, `org`, `verified`, `tier` |

## 3. QUICK PAYLOADS

```json
{"role":"admin"}
{"isAdmin":true}
{"org":"target-company"}
{"verified":true}
```

## 4. WHAT TESTERS MISS

- object IDs in headers, cookies, GraphQL args, and nested objects
- alternate methods sharing the same route but weaker authz
- parent check present, child resource check missing
- admin docs revealing extra writable fields

## 5. NEXT ROUTING

- For JWT or token-layer abuse: [api auth and jwt abuse](../api-auth-and-jwt-abuse/SKILL.md)
- For GraphQL and hidden parameter discovery: [graphql and hidden parameters](../graphql-and-hidden-parameters/SKILL.md)
- For broader IDOR patterns outside APIs: [idor broken object authorization](../idor-broken-object-authorization/SKILL.md)---
name: api-recon-and-docs
description: >-
  API reconnaissance and documentation review playbook. Use when discovering endpoints, schemas, versions, OpenAPI specs, hidden docs, and surface area for API testing.
---

# SKILL: API Recon and Docs — Endpoints, Schemas, and Version Surface

> **AI LOAD INSTRUCTION**: Use this skill first when the target is a REST, mobile, or GraphQL API and you need to enumerate endpoints, documentation, versions, and hidden surface area before exploitation.

## 1. PRIMARY GOALS

1. Discover all reachable API entrypoints.
2. Extract schemas, optional fields, and role differences.
3. Identify old versions, mobile paths, GraphQL endpoints, and undocumented parameters.

## 2. RECON CHECKLIST

### JavaScript and client mining

```bash
curl https://target/app.js | grep -oE '(/api|/rest|/graphql)[^"'\'' ]+' | sort -u
```

### Common documentation and schema paths

```text
/swagger.json
/openapi.json
/api-docs
/docs
/.well-known/
/graphql
/gql
```

### Version and product drift

```text
/api/v1/
/api/v2/
/api/mobile/v1/
/legacy/
```

## 3. WHAT TO EXTRACT FROM DOCS

- optional and undocumented fields
- admin-only request examples
- deprecated endpoints that may still be active
- schema hints like `additionalProperties: true`
- parameter names tied to filtering, sorting, IDs, roles, or tenancy

## 4. NEXT ROUTING

| Finding | Next Skill |
|---|---|
| object IDs everywhere | [api authorization and bola](../api-authorization-and-bola/SKILL.md) |
| JWT, OAuth, role claims | [api auth and jwt abuse](../api-auth-and-jwt-abuse/SKILL.md) |
| GraphQL or hidden fields | [graphql and hidden parameters](../graphql-and-hidden-parameters/SKILL.md) |
| strong auth boundary but suspicious business flow | [business logic vulnerabilities](../business-logic-vulnerabilities/SKILL.md) |