import pkg from "../package.json" with { type: "json" };

const errorSchema = {
  type: "object",
  required: ["error", "code"],
  properties: {
    error: { type: "string" },
    code: { type: "string" },
  },
} as const;

const errorResponse = {
  description: "Error",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
};

const optionalBearer = [{ bearerAuth: [] }, { sessionCookie: [] }, {}];
const liveOrSession = [{ bearerAuth: [] }, { sessionCookie: [] }];

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const tokenParam = {
  name: "token",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Signing-ceremony token. Not a public account URL.",
};

const brandingSchema = {
  type: "object",
  required: ["display_name", "has_logo", "can_edit"],
  properties: {
    display_name: { type: ["string", "null"] },
    has_logo: { type: "boolean" },
    can_edit: { type: "boolean" },
  },
} as const;

const templateRoleSchema = {
  type: "object",
  properties: {
    signing_order: { type: "integer" },
    role_name: { type: "string" },
  },
} as const;

const fieldAreaSchema = {
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1, description: "1-based page index" },
    x: { type: "number", description: "Percent from left" },
    y: { type: "number", description: "Percent from top" },
    w: { type: "number" },
    h: { type: "number" },
  },
} as const;

const documentFieldSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: {
      type: "string",
      enum: ["signature", "initials", "date", "name", "text", "checkbox"],
    },
    role: { type: "string" },
    required: { type: "boolean" },
    readonly: { type: "boolean" },
    default_value: { type: ["string", "boolean"] },
    areas: { type: "array", items: fieldAreaSchema },
  },
} as const;

const createExtrasProperties = {
  fields: {
    type: "string",
    description:
      "JSON array of DocumentField. page is 1-based; x/y/w/h are percent top-left. Merged with PDF {{sig}}/{{date}}/{{name}} tags.",
  },
  values: {
    type: "string",
    description: "JSON object of prefilled field values by field name.",
  },
  order: {
    type: "string",
    enum: ["sequential", "parallel"],
    description: "Signing mode. Default sequential.",
  },
  send_email: {
    type: "boolean",
    description: "When false, mint sign URLs without sending invite email.",
  },
  completed_redirect_url: {
    type: "string",
    description: "Optional https redirect after the human ceremony.",
  },
  embed_origin: {
    type: "string",
    description: "Allowed iframe parent origin for ceremony postMessage/CSP.",
  },
} as const;

const templateSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    roles: { type: "array", items: templateRoleSchema },
    fields: { type: "array", items: documentFieldSchema },
    created_at: { type: "string", format: "date-time" },
  },
} as const;

const agentSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    slug: { type: "string" },
    name: { type: "string" },
    has_webhook: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    revoked_at: { type: ["string", "null"], format: "date-time" },
  },
} as const;

const verifySchema = {
  type: "object",
  required: ["valid"],
  properties: {
    valid: { type: "boolean" },
    code: { type: "string" },
    sha256: { type: "string" },
    document_id: { type: "string", format: "uuid" },
    human_signatures: { type: "integer" },
    agent_attestations: { type: "integer" },
    parties: { type: "array", items: { type: "object" } },
  },
} as const;

const teamMemberSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    email: { type: "string", format: "email" },
    status: { type: "string", enum: ["invited", "active"] },
    role: { type: "string", enum: ["owner", "member"] },
  },
} as const;

const teamJson = {
  type: "object",
  properties: {
    owner_email: { type: "string", format: "email" },
    entitled: { type: "boolean" },
    role: { type: "string", enum: ["owner", "member"] },
    members: { type: "array", items: teamMemberSchema },
  },
} as const;

const liveKeyNote =
  "Session cookie or sign_live_ Bearer. Never sign_tmp_. Never ?apiKey=. Cloud Free gets 403 pro_required; SELF_HOST=1 is entitled.";

const brandingJson = {
  description: "Team branding",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Branding" },
    },
  },
};

const templateJson = {
  description: "Template",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Template" },
    },
  },
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "AgentSign",
    version: pkg.version,
    description:
      "AgentSign is a signing primitive. Human always signs. Bearer keys authenticate the caller and never skip the signer. No sign tool. Humans Finish. Agents Attest. On-page fields via PDF tags or fields JSON. Branding, templates, and team are REST for logged-in Pro or SELF_HOST. Errors are JSON { error, code }.",
  },
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "sb-access-token",
        description:
          "Signed-in browser session. These operations serve the portal and reject API keys and OAuth tokens.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "sign_live_ (user-minted), sign_tmp_ (document-scoped), or sign_agent_ (named-agent paste key). POST /v1/documents: omit Authorization for a sender OTP one-off, or send sign_live_ to skip OTP. sign_tmp_ cannot create or list documents; it can GET/DELETE/PDF that document. List, branding, templates, team, and agents need a session cookie or sign_live_ (never sign_tmp_). Attest/reject accept sign_agent_ or live/session naming { agent }. Verify is unauthenticated.",
      },
    },
    schemas: {
      Error: errorSchema,
      Branding: brandingSchema,
      Template: templateSchema,
      DocumentField: documentFieldSchema,
      Agent: agentSchema,
      Verify: verifySchema,
    },
  },
  paths: {
    "/v1/documents": {
      post: {
        summary: "Create and send a document",
        description:
          "Markdown content or multipart PDF/DOCX bytes, plus signers — exactly one of markdown or file. Markdown is rendered to a clean PDF server-side; {{sig}} tags place fields. DOCX is converted to PDF (503 docx_unavailable when conversion is down). Optional Bearer. Omit Authorization to start a sender OTP one-off (pending_sender); a session whose email matches sender_email sends directly unless Confirm my sends is on. OAuth callers return pending_sender while Confirm agent sends is on (the default) — the account owner approves with the emailed code. Live keys are standing authorizations and always send immediately. Optional fields/values/order/send_email/completed_redirect_url/embed_origin. Free one-offs accept PDF {{sig}} tags. Human always signs.",
        security: optionalBearer,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["title", "sender_email", "signers"],
                properties: {
                  title: { type: "string" },
                  sender_email: { type: "string", format: "email" },
                  signers: {
                    type: "string",
                    description:
                      "JSON array of { name, email, kind?, agent?, role?, values? }. kind is human (default) or agent; agent is the team agent slug when kind is agent.",
                  },
                  markdown: {
                    type: "string",
                    description:
                      "Document content as markdown (max 1 MiB). Rendered to PDF server-side; {{sig}} tags place fields (tags inside code blocks stay literal). Latin-1 text only: characters outside WinAnsi (emoji, CJK) are dropped from the rendered PDF. Provide markdown or file, not both.",
                  },
                  file: {
                    type: "string",
                    format: "binary",
                    description:
                      "PDF or DOCX bytes. Provide markdown or file, not both.",
                  },
                  ...createExtrasProperties,
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    signers: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "429": errorResponse,
          "500": errorResponse,
          "503": errorResponse,
        },
      },
      get: {
        summary: "List documents sent or signed",
        security: liveOrSession,
        responses: {
          "200": {
            description: "List",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    documents: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/v1/documents/{id}": {
      get: {
        summary: "Document status and audit",
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "200": {
            description: "Status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    title: { type: "string" },
                    expires_at: { type: "string" },
                    shred_at: { type: "string" },
                    fields: {
                      type: "array",
                      items: { $ref: "#/components/schemas/DocumentField" },
                    },
                    signing_mode: {
                      type: "string",
                      enum: ["sequential", "parallel"],
                    },
                    send_email: { type: "boolean" },
                    current_party: { type: ["object", "null"] },
                    signers: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          kind: { type: "string" },
                          email: { type: "string" },
                          role: { type: "string" },
                          values: { type: "object" },
                          sign_url: {
                            type: "string",
                            description: "Owner-only human ceremony path.",
                          },
                        },
                      },
                    },
                    audit: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
        },
      },
      delete: {
        summary: "Void and purge a document",
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
        },
      },
    },
    "/v1/documents/{id}.pdf": {
      get: {
        summary: "Download the sealed PDF",
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "200": {
            description: "Sealed PDF",
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "410": errorResponse,
        },
      },
    },
    "/v1/documents/{id}/attest": {
      post: {
        summary: "Attest as the current agent party",
        description:
          "Current party must be an agent this caller may use. sign_agent_ infers the slug. Live/session must JSON { agent }. Completes if last party and a human already Finished, or agent_only_attest is on. Otherwise pending. Keys never Finish. No sign tool. Humans Finish. Agents Attest.",
        security: liveOrSession,
        parameters: [idParam],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  agent: {
                    type: "string",
                    description: "Named-agent slug. Required for live/session.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Attested (pending or completed)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    id: { type: "string" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "410": errorResponse,
        },
      },
    },
    "/v1/documents/{id}/reject": {
      post: {
        summary: "Reject as the current agent party",
        description:
          "Same auth as attest. Sets rejected_at and declines the document. No sign tool. Humans Finish. Agents Attest.",
        security: liveOrSession,
        parameters: [idParam],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  agent: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Declined",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    id: { type: "string" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "410": errorResponse,
        },
      },
    },
    "/v1/documents/{id}/otp": {
      post: {
        summary: "Verify the sender's emailed OTP and send",
        description:
          "Unauthenticated: completes the sender OTP one-off started by POST /v1/documents without a Bearer. JSON { code }. Wrong code 400 invalid_otp; 5 wrong attempts or an expired/already-used code is 403 otp_locked / 410 otp_expired. On success the document moves to pending, the first signer is invited, and a one-off sign_tmp_ key is returned. 429 send_limit when the sender is over the free-tier cap.",
        security: [],
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["code"],
                properties: {
                  code: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Verified and sent",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    key: { type: "string" },
                    signers: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "410": errorResponse,
          "429": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/v1/verify": {
      post: {
        summary: "Verify a sealed PDF",
        description:
          "Unauthenticated. Raw PDF bytes or multipart file. Checks our P12 seal. No DB. valid false with code not_our_seal if unsigned or not ours.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/pdf": {
              schema: { type: "string", format: "binary" },
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary", description: "PDF bytes" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Verify result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Verify" },
              },
            },
          },
          "400": errorResponse,
        },
      },
    },
    "/v1/keys": {
      post: {
        summary: "Mint a live key",
        description:
          "Session cookie only — never a Bearer key, and ?apiKey= is rejected. Optional JSON { expires_in_days } (positive number; a server default applies otherwise). Returns the sign_live_ key once; it is never shown again.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  expires_in_days: { type: "number", exclusiveMinimum: 0 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Minted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    prefix: { type: "string" },
                    expires_at: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
        },
      },
    },
    "/v1/agents": {
      get: {
        summary: "List named agents",
        description: `${liveKeyNote} Owner or member. No secrets. Pro required.`,
        security: liveOrSession,
        responses: {
          "200": {
            description: "List",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agents: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Agent" },
                    },
                    can_edit: { type: "boolean" },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
        },
      },
      post: {
        summary: "Create a named agent",
        description: `${liveKeyNote} Owner only. Returns sign_agent_ once. Cap 10 active. Optional webhook_url.`,
        security: liveOrSession,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["slug", "name"],
                properties: {
                  slug: { type: "string" },
                  name: { type: "string" },
                  webhook_url: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    slug: { type: "string" },
                    name: { type: "string" },
                    has_webhook: { type: "boolean" },
                    created_at: { type: "string", format: "date-time" },
                    revoked_at: { type: ["string", "null"] },
                    key: { type: "string" },
                    prefix: { type: "string" },
                    webhook_secret: { type: "string" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "409": errorResponse,
        },
      },
    },
    "/v1/agents/{id}": {
      delete: {
        summary: "Revoke a named agent",
        description: `${liveKeyNote} Owner only. Expires paste keys.`,
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "204": { description: "Revoked" },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/v1/agents/{id}/rotate": {
      post: {
        summary: "Rotate the named-agent paste key",
        description: `${liveKeyNote} Owner only. New sign_agent_ shown once. Old hash dead.`,
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "200": {
            description: "Rotated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    slug: { type: "string" },
                    name: { type: "string" },
                    has_webhook: { type: "boolean" },
                    key: { type: "string" },
                    prefix: { type: "string" },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/v1/agents/{id}/webhook": {
      put: {
        summary: "Set or clear the agent webhook URL",
        description: `${liveKeyNote} Owner only. New HMAC secret shown once when a URL is set.`,
        security: liveOrSession,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["webhook_url"],
                properties: {
                  webhook_url: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    webhook_secret: { type: "string" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/v1/branding": {
      get: {
        summary: "Get team branding",
        description: `${liveKeyNote} Owner or member. JSON includes can_edit.`,
        security: liveOrSession,
        responses: {
          "200": brandingJson,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
      put: {
        summary: "Update display name and optional logo",
        description: `${liveKeyNote} Owner only. Multipart or JSON. Empty display_name clears the name. Logo is PNG or JPEG under 256 KiB.`,
        security: liveOrSession,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  display_name: {
                    type: "string",
                    description: "1–80 chars, or empty to clear",
                  },
                  logo: {
                    type: "string",
                    format: "binary",
                    description: "PNG or JPEG, max 256 KiB",
                  },
                },
              },
            },
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  display_name: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        responses: {
          "200": brandingJson,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/branding/logo": {
      delete: {
        summary: "Remove the team logo",
        description: `${liveKeyNote} Owner only.`,
        security: liveOrSession,
        responses: {
          "200": brandingJson,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/templates": {
      get: {
        summary: "List saved templates",
        description: `${liveKeyNote} Owner or member. Quiet cap 50 per team.`,
        security: liveOrSession,
        responses: {
          "200": {
            description: "List",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    templates: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Template" },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
        },
      },
      post: {
        summary: "Save a template (PDF + ordered roles)",
        description: `${liveKeyNote} Multipart title + roles JSON + file (PDF or DOCX; DOCX is converted to PDF), or document_id to copy the original PDF. Roles are labels, not people. MCP: list_templates / send_template.`,
        security: liveOrSession,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  roles: {
                    type: "string",
                    description: 'JSON array of { role_name }',
                  },
                  file: { type: "string", format: "binary", description: "PDF or DOCX bytes" },
                  document_id: {
                    type: "string",
                    format: "uuid",
                    description: "Copy original PDF and default role names from a document",
                  },
                },
              },
            },
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  roles: {
                    type: "array",
                    items: { type: "object", properties: { role_name: { type: "string" } } },
                  },
                  document_id: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "201": templateJson,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "429": errorResponse,
          "500": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/v1/templates/{id}": {
      get: {
        summary: "Get a template",
        description: liveKeyNote,
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "200": templateJson,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
      patch: {
        summary: "Update template title and/or roles",
        description: `${liveKeyNote} Does not replace the PDF.`,
        security: liveOrSession,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  roles: {
                    type: "array",
                    items: { type: "object", properties: { role_name: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": templateJson,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
      delete: {
        summary: "Delete a template and its PDF",
        description: liveKeyNote,
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "204": { description: "Deleted" },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/v1/templates/{id}/send": {
      post: {
        summary: "Send a template as a new document",
        description: `${liveKeyNote} signers.length must equal role count; order is signing_order. Copies template fields. Optional values, order, send_email, completed_redirect_url, embed_origin. Creates a normal document (same clocks, invite, cap). Human always signs.`,
        security: liveOrSession,
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["signers"],
                properties: {
                  signers: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["name", "email"],
                      properties: {
                        name: { type: "string" },
                        email: { type: "string", format: "email" },
                        role: { type: "string" },
                        values: { type: "object" },
                      },
                    },
                  },
                  values: { type: "object" },
                  order: {
                    type: "string",
                    enum: ["sequential", "parallel"],
                  },
                  send_email: { type: "boolean" },
                  completed_redirect_url: { type: "string" },
                  embed_origin: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Document created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "429": errorResponse,
        },
      },
    },
    "/v1/team": {
      get: {
        summary: "List team members",
        description:
          "Session cookie or sign_live_ Bearer. Never sign_tmp_. Returns owner plus members. entitled is false for cloud Free (not 403).",
        security: liveOrSession,
        responses: {
          "200": {
            description: "Team",
            content: {
              "application/json": {
                schema: teamJson,
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/v1/team/invites": {
      post: {
        summary: "Invite a teammate",
        description: `${liveKeyNote} Owner only. Cap 10 including the owner. Re-invite of an invited email remints the token.`,
        security: liveOrSession,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Invited",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    email: { type: "string" },
                    status: { type: "string", enum: ["invited"] },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "409": errorResponse,
        },
      },
    },
    "/v1/team/members/{id}": {
      delete: {
        summary: "Remove an invited or active member",
        description: `${liveKeyNote} Owner only. Cannot delete the owner.`,
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "204": { description: "Removed" },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/team/accept": {
      post: {
        summary: "Accept a team invite",
        description:
          "Logged-in session only (not a live key). Session email must match the invite. JSON { token } or form token.",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token"],
                properties: { token: { type: "string" } },
              },
            },
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["token"],
                properties: { token: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Accepted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    email: { type: "string" },
                    status: { type: "string", enum: ["active"] },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "410": errorResponse,
        },
      },
    },
    "/v1/workspace": {
      get: {
        summary: "Get workspace settings",
        description: "Session or live key. Name, timezone, description, and app id.",
        security: liveOrSession,
        responses: {
          "200": {
            description: "Workspace",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": errorResponse,
        },
      },
      patch: {
        summary: "Update workspace name, timezone, or description",
        description: `${liveKeyNote} Owner only. Allowed on Free.`,
        security: liveOrSession,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  display_name: { type: ["string", "null"] },
                  timezone: { type: ["string", "null"] },
                  description: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Workspace",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/workspace/export": {
      get: {
        summary: "Export workspace metadata as JSON",
        security: liveOrSession,
        responses: {
          "200": { description: "Attachment" },
          "401": errorResponse,
        },
      },
    },
    "/v1/workspace/dissolve": {
      post: {
        summary: "Remove all members; keep documents and login",
        description: `${liveKeyNote} Owner only.`,
        security: liveOrSession,
        responses: {
          "204": { description: "Dissolved" },
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/team/leave": {
      post: {
        summary: "Leave the team you belong to",
        description: "Members only. Owner cannot leave.",
        security: liveOrSession,
        responses: {
          "204": { description: "Left" },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/v1/billing": {
      get: {
        summary: "Plan, usage, and payment method",
        security: liveOrSession,
        responses: {
          "200": {
            description: "Billing",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "401": errorResponse,
        },
      },
    },
    "/v1/billing/portal": {
      post: {
        summary: "Open Stripe Customer Portal",
        description: `${liveKeyNote} Pro owner only.`,
        security: liveOrSession,
        responses: {
          "303": { description: "Redirect to Stripe" },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/activity": {
      get: {
        summary: "Recent notable events on the team's documents",
        description:
          "Session cookie only. Feeds the portal activity feed, not the public API. Up to 30 most recent sent/opened/consented/signed/attested/declined/rejected/reminded/expired events, newest first.",
        security: [{ sessionCookie: [] }],
        tags: ["Internal"],
        responses: {
          "200": {
            description: "Activity",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    events: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          event: { type: "string" },
                          document_id: { type: "string", format: "uuid" },
                          title: { type: "string" },
                          actor: { type: ["string", "null"] },
                          actor_kind: { type: ["string", "null"] },
                          at: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/v1/stats": {
      get: {
        summary: "Dashboard aggregates for the team's documents",
        description:
          "Session cookie only. Feeds the portal dashboard, not the public API. Sends/completions this vs last month, a 14-day daily trend, median signing hours, documents shredding within 7 days, and 30-day webhook counts.",
        security: [{ sessionCookie: [] }],
        tags: ["Internal"],
        responses: {
          "200": {
            description: "Stats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    total: { type: "integer" },
                    by_status: {
                      type: "object",
                      additionalProperties: { type: "integer" },
                    },
                    sent: {
                      type: "object",
                      properties: {
                        this_month: { type: "integer" },
                        last_month: { type: "integer" },
                        agent_share: {
                          type: "number",
                          description: "Share of documents with an agent party, 0 to 1.",
                        },
                      },
                    },
                    completed: {
                      type: "object",
                      properties: {
                        this_month: { type: "integer" },
                        last_month: { type: "integer" },
                      },
                    },
                    daily: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          date: { type: "string", format: "date" },
                          human: { type: "integer" },
                          agent: { type: "integer" },
                          completed: { type: "integer" },
                        },
                      },
                    },
                    median_signing_hours: { type: ["number", "null"] },
                    shredding_soon: { type: "integer" },
                    webhooks_30d: {
                      type: "object",
                      properties: {
                        sent: { type: "integer" },
                        failed: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/v1/sending": {
      get: {
        summary: "Get send-confirmation settings",
        description:
          "Session only — an agent or API key must never read or change its own approval gate.",
        security: [{ sessionCookie: [] }],
        tags: ["Internal"],
        responses: {
          "200": {
            description: "Sending settings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    confirm_agent_sends: { type: "boolean" },
                    confirm_human_sends: { type: "boolean" },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "403": errorResponse,
        },
      },
      patch: {
        summary: "Update send-confirmation settings",
        description:
          "Session only. JSON confirm_agent_sends and/or confirm_human_sends booleans.",
        security: [{ sessionCookie: [] }],
        tags: ["Internal"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  confirm_agent_sends: { type: "boolean" },
                  confirm_human_sends: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Sending settings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    confirm_agent_sends: { type: "boolean" },
                    confirm_human_sends: { type: "boolean" },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/detect-fields": {
      post: {
        summary: "AI field suggestions for an uploaded PDF",
        description:
          "Session cookie only. Behind the ai_field_detect flag (404 not_found when off). Requires an AI Gateway credential (503 not_configured otherwise). Multipart PDF up to 20 MiB. Rate limited to 10 requests per 10 minutes per user.",
        security: [{ sessionCookie: [] }],
        tags: ["Internal"],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "PDF bytes, max 20 MiB",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Suggested fields",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    fields: {
                      type: "array",
                      items: { $ref: "#/components/schemas/DocumentField" },
                    },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "404": errorResponse,
          "429": errorResponse,
          "502": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/s/{token}/logo": {
      get: {
        summary: "Ceremony logo bytes",
        description:
          "Signing token only. 200 image bytes if that document's team has a logo; 404 otherwise. Not a public account URL.",
        security: [],
        parameters: [tokenParam],
        responses: {
          "200": {
            description: "PNG or JPEG",
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": errorResponse,
          "410": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/s/{token}/preview": {
      get: {
        summary: "Original PDF preview for the ceremony",
        description:
          "Signing token only. Returns the original unsigned PDF while the signer may open the ceremony. 409 sequential_wait / 410 expired as the ceremony state GET.",
        security: [],
        parameters: [tokenParam],
        responses: {
          "200": {
            description: "Original PDF",
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
            },
          },
          "404": errorResponse,
          "409": errorResponse,
          "410": errorResponse,
          "503": errorResponse,
        },
      },
    },
  },
} as const;
