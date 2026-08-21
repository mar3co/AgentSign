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

const bearer = [{ bearerAuth: [] }];
const optionalBearer = [{ bearerAuth: [] }, {}];
const liveOrSession = [{ bearerAuth: [] }];

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

const packetRoleSchema = {
  type: "object",
  properties: {
    signing_order: { type: "integer" },
    role_name: { type: "string" },
  },
} as const;

const packetSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    title: { type: "string" },
    roles: { type: "array", items: packetRoleSchema },
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
    envelope_id: { type: "string", format: "uuid" },
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

const cabinetJson = {
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
  description: "Cabinet branding",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Branding" },
    },
  },
};

const packetJson = {
  description: "Packet",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Packet" },
    },
  },
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "AgentSign",
    version: "1.2.0",
    description:
      "AgentSign is a signing primitive. Human always signs. Bearer keys authenticate the caller and never skip the signer. No sign tool. Humans Finish. Agents Attest. Branding, packets, and team are REST for logged-in Pro or SELF_HOST. Errors are JSON { error, code }.",
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "sign_live_ (user-minted), sign_tmp_ (envelope-scoped), or sign_agent_ (named-agent paste key). POST /v1/envelopes: omit Authorization for a sender OTP one-off, or send sign_live_ to skip OTP. sign_tmp_ cannot create or list envelopes; it can GET/DELETE/PDF that envelope. List, branding, packets, team, and agents need a session cookie or sign_live_ (never sign_tmp_). Attest/reject accept sign_agent_ or live/session naming { agent }. Verify is unauthenticated.",
      },
    },
    schemas: {
      Error: errorSchema,
      Branding: brandingSchema,
      Packet: packetSchema,
      Agent: agentSchema,
      Verify: verifySchema,
    },
  },
  paths: {
    "/v1/envelopes": {
      post: {
        summary: "Create and send an envelope",
        description:
          "Multipart PDF bytes + signers. Optional Bearer. Omit Authorization to start a sender OTP one-off (pending_sender). Live key skips OTP. Human always signs.",
        security: optionalBearer,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["title", "sender_email", "signers", "file"],
                properties: {
                  title: { type: "string" },
                  sender_email: { type: "string", format: "email" },
                  signers: {
                    type: "string",
                    description:
                      "JSON array of { name, email, kind?, agent? }. kind is human (default) or agent; agent is the cabinet slug when kind is agent.",
                  },
                  file: { type: "string", format: "binary", description: "PDF bytes" },
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
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "429": errorResponse,
        },
      },
      get: {
        summary: "List envelopes sent or signed",
        security: bearer,
        responses: {
          "200": {
            description: "List",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    envelopes: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/v1/envelopes/{id}": {
      get: {
        summary: "Envelope status and audit",
        security: bearer,
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
                    signers: { type: "array", items: { type: "object" } },
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
        summary: "Void and purge an envelope",
        security: bearer,
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
    "/v1/envelopes/{id}.pdf": {
      get: {
        summary: "Download the sealed PDF",
        security: bearer,
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
    "/v1/envelopes/{id}/attest": {
      post: {
        summary: "Attest as the current agent party",
        description:
          "Current party must be an agent this caller may use. sign_agent_ infers the slug. Live/session must JSON { agent }. Completes if last party and a human already Finished, or agent_only_attest is on. Otherwise pending. Keys never Finish. No sign tool. Humans Finish. Agents Attest.",
        security: bearer,
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
    "/v1/envelopes/{id}/reject": {
      post: {
        summary: "Reject as the current agent party",
        description:
          "Same auth as attest. Sets rejected_at and declines the envelope. No sign tool. Humans Finish. Agents Attest.",
        security: bearer,
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
        summary: "Get cabinet branding",
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
        summary: "Remove the cabinet logo",
        description: `${liveKeyNote} Owner only.`,
        security: liveOrSession,
        responses: {
          "200": brandingJson,
          "401": errorResponse,
          "403": errorResponse,
        },
      },
    },
    "/v1/packets": {
      get: {
        summary: "List saved packets",
        description: `${liveKeyNote} Owner or member. Quiet cap 50 per cabinet.`,
        security: liveOrSession,
        responses: {
          "200": {
            description: "List",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    packets: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Packet" },
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
        summary: "Save a packet (PDF + ordered roles)",
        description: `${liveKeyNote} Multipart title + roles JSON + file, or envelope_id to copy the original PDF. Roles are labels, not people. MCP: list_packets / send_packet.`,
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
                  file: { type: "string", format: "binary", description: "PDF bytes" },
                  envelope_id: {
                    type: "string",
                    format: "uuid",
                    description: "Copy original PDF and default role names from an envelope",
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
                  envelope_id: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "201": packetJson,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/v1/packets/{id}": {
      get: {
        summary: "Get a packet",
        description: liveKeyNote,
        security: liveOrSession,
        parameters: [idParam],
        responses: {
          "200": packetJson,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
      patch: {
        summary: "Update packet title and/or roles",
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
          "200": packetJson,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
        },
      },
      delete: {
        summary: "Delete a packet and its PDF",
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
    "/v1/packets/{id}/send": {
      post: {
        summary: "Send a packet as a new envelope",
        description: `${liveKeyNote} signers.length must equal role count; order is signing_order. Creates a normal envelope (same clocks, invite, cap). Human always signs.`,
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
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Envelope created",
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
        summary: "List the cabinet team",
        description:
          "Session cookie or sign_live_ Bearer. Never sign_tmp_. Returns owner plus members. entitled is false for cloud Free (not 403).",
        security: liveOrSession,
        responses: {
          "200": {
            description: "Team",
            content: {
              "application/json": {
                schema: cabinetJson,
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
        security: [],
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
    "/s/{token}/logo": {
      get: {
        summary: "Ceremony logo bytes",
        description:
          "Signing token only. 200 image bytes if that envelope's cabinet has a logo; 404 otherwise. Not a public account URL.",
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
        },
      },
    },
  },
} as const;
