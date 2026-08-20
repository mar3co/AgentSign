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

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Sign",
    version: "0.1.0",
    description:
      "Signing primitive. Human always signs. Bearer keys authenticate the caller and never skip the signer. Errors are JSON { error, code }.",
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "sign_tmp_ (envelope-scoped) or sign_live_ (user-minted). Optional on POST /v1/envelopes.",
      },
    },
    schemas: {
      Error: errorSchema,
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
                    description: 'JSON array of { name, email }',
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
  },
} as const;
