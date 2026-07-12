/**
 * OpenAPI 3.1.0 Specification for Sentinel Threat Intelligence API (v1)
 * 
 * Provides structural schemas, endpoints, error scenarios, pagination details,
 * and comprehensive request/response payloads for developer integration.
 */
export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Sentinel Cyber Intelligence API",
    description: "Enterprise multi-source security scanners, OSINT correlation, and AI-driven cognitive threat reporting.",
    version: "1.0.0",
    contact: {
      name: "Sentinel SecOps Support",
      email: "buildwisegroupofcompany@gmail.com",
      url: "https://sentinelapi.dev"
    }
  },
  servers: [
    {
      url: "/api/v1",
      description: "Default Version 1 Root Ingress"
    }
  ],
  security: [
    {
      ApiKeyAuth: []
    },
    {
      BearerAuth: []
    }
  ],
  paths: {
    "/auth/me": {
      get: {
        summary: "Retrieve Current Authenticated Session",
        description: "Returns metadata of the current session user.",
        operationId: "getAuthMe",
        tags: ["Authentication"],
        responses: {
          "200": {
            description: "Session profile retrieved successfully.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/User"
                },
                example: {
                  id: "usr_sentinel_94921",
                  email: "buildwisegroupofcompany@gmail.com",
                  name: "Staff Engineer Dev",
                  companyName: "Sentinel Tech Corp",
                  plan: "Pro",
                  createdAt: "2026-02-15T08:00:00Z"
                }
              }
            }
          },
          "401": {
            $ref: "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/auth/login": {
      post: {
        summary: "Authenticate/Create User Session",
        description: "Logs in a user and establishes a local context.",
        operationId: "authLogin",
        tags: ["Authentication"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                  companyName: { type: "string" }
                }
              },
              example: {
                email: "buildwisegroupofcompany@gmail.com",
                name: "Staff Engineer Dev",
                companyName: "Sentinel Tech Corp"
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Session established successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { $ref: "#/components/schemas/User" }
                  }
                },
                example: {
                  user: {
                    id: "usr_sentinel_94921",
                    email: "buildwisegroupofcompany@gmail.com",
                    name: "Staff Engineer Dev",
                    companyName: "Sentinel Tech Corp",
                    plan: "Pro",
                    createdAt: "2026-02-15T08:00:00Z"
                  }
                }
              }
            }
          },
          "400": {
            $ref: "#/components/responses/BadRequest"
          }
        }
      }
    },
    "/auth/logout": {
      post: {
        summary: "Terminate User Session",
        description: "Clears current active local user profile context.",
        operationId: "authLogout",
        tags: ["Authentication"],
        responses: {
          "200": {
            description: "Session terminated.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    user: { $ref: "#/components/schemas/User" }
                  }
                },
                example: {
                  success: true,
                  user: {
                    id: "usr_guest",
                    email: "guest@sentinelapi.dev",
                    name: "Guest Mode",
                    companyName: "Guest Workspace",
                    plan: "Free",
                    createdAt: "2026-07-12T04:00:00Z"
                  }
                }
              }
            }
          }
        }
      }
    },
    "/keys": {
      get: {
        summary: "List Active Developer API Keys",
        description: "Retrieves developer credentials and quotas for the profile context.",
        operationId: "listKeys",
        tags: ["API Key Management"],
        responses: {
          "200": {
            description: "Keys returned successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    keys: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ApiKey" }
                    }
                  }
                },
                example: {
                  keys: [
                    {
                      id: "key_01",
                      name: "Production Gateway",
                      secret: "sn_live_8f3c7a91de884b2ab72c67e810a01fa2",
                      status: "active",
                      createdAt: "2026-03-01T10:14:00Z",
                      lastUsedAt: "2026-07-11T04:12:00Z",
                      requestCount: 849202,
                      rateLimit: 1200
                    }
                  ]
                }
              }
            }
          },
          "401": {
            $ref: "#/components/responses/Unauthorized"
          }
        }
      },
      post: {
        summary: "Generate a New API Key",
        description: "Provisions a cryptographically secure token for background and SDK integration.",
        operationId: "createKey",
        tags: ["API Key Management"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", description: "Descriptive label for key usage." },
                  rateLimit: { type: "integer", default: 300, description: "Maximum requests permitted per minute." }
                }
              },
              example: {
                name: "CI/CD Threat Scanner",
                rateLimit: 600
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Key created.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    key: { $ref: "#/components/schemas/ApiKey" }
                  }
                },
                example: {
                  key: {
                    id: "key_new_931",
                    name: "CI/CD Threat Scanner",
                    secret: "sn_live_9d2c8f84be1a70cc2b4ff928cc81dc41",
                    status: "active",
                    createdAt: "2026-07-12T04:05:00Z",
                    lastUsedAt: null,
                    requestCount: 0,
                    rateLimit: 600
                  }
                }
              }
            }
          },
          "400": {
            $ref: "#/components/responses/BadRequest"
          }
        }
      }
    },
    "/keys/{id}/revoke": {
      put: {
        summary: "Revoke API Key Credential",
        description: "Immediately deactivates the credential, blocking further pipeline queries.",
        operationId: "revokeKey",
        tags: ["API Key Management"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Target key ID to revoke"
          }
        ],
        responses: {
          "200": {
            description: "Key revoked successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    key: { $ref: "#/components/schemas/ApiKey" }
                  }
                },
                example: {
                  key: {
                    id: "key_01",
                    name: "Production Gateway",
                    secret: "sn_live_8f3c7a91de884b2ab72c67e810a01fa2",
                    status: "revoked",
                    createdAt: "2026-03-01T10:14:00Z",
                    lastUsedAt: "2026-07-11T04:12:00Z",
                    requestCount: 849202,
                    rateLimit: 1200
                  }
                }
              }
            }
          },
          "404": {
            $ref: "#/components/responses/NotFound"
          }
        }
      }
    },
    "/keys/{id}/rotate": {
      post: {
        summary: "Rotate API Key Secret Token",
        description: "Replaces the cryptographic token with a fresh secure signature while keeping historical logs intact.",
        operationId: "rotateKey",
        tags: ["API Key Management"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Target key ID to rotate"
          }
        ],
        responses: {
          "200": {
            description: "Key signature successfully rotated.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    key: { $ref: "#/components/schemas/ApiKey" }
                  }
                },
                example: {
                  key: {
                    id: "key_01",
                    name: "Production Gateway",
                    secret: "sn_live_7c3d4a21ba892cfa928cf828ef0e92ca",
                    status: "active",
                    createdAt: "2026-07-12T04:06:00Z",
                    lastUsedAt: "2026-07-11T04:12:00Z",
                    requestCount: 849202,
                    rateLimit: 1200
                  }
                }
              }
            }
          },
          "404": {
            $ref: "#/components/responses/NotFound"
          }
        }
      }
    },
    "/investigate": {
      post: {
        summary: "Run Synchronous Target Scan",
        description: "Triggers parallel WHOIS, DNS, GitHub contributor registries, and news scanners synchronously, analyzing output with Gemini.",
        operationId: "runInvestigateSync",
        tags: ["Investigation Engine"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type", "value"],
                properties: {
                  type: { type: "string", enum: ["domain", "company", "email", "username"], description: "Target registry category." },
                  value: { type: "string", description: "Scannable term, e.g. 'openai.com'." }
                }
              },
              example: {
                type: "domain",
                value: "openai.com"
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Investigation completed. Analytical intelligence model synthesized.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvestigationResult"
                },
                example: {
                  summary: "Strategic scans completed on openai.com.",
                  executiveSummary: "Target exhibits a defensive, highly robust structural infrastructure with validated DNS mappings.",
                  entities: [],
                  relationships: [],
                  canonicalEntities: [],
                  timeline: [],
                  confidence: 95,
                  riskScore: 12,
                  sources: [],
                  evidences: []
                }
              }
            }
          },
          "400": {
            $ref: "#/components/responses/BadRequest"
          },
          "401": {
            $ref: "#/components/responses/Unauthorized"
          },
          "500": {
            $ref: "#/components/responses/InternalError"
          }
        }
      }
    },
    "/investigations": {
      post: {
        summary: "Spawn Asynchronous Investigation Job",
        description: "Creates an unblocking background worker job, performing scanners asynchronously. Highly recommended for slow network requests.",
        operationId: "createInvestigationJob",
        tags: ["Investigation Jobs"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type", "value"],
                properties: {
                  type: { type: "string", enum: ["domain", "company", "email", "username"], description: "Scanning filter category." },
                  value: { type: "string", description: "Search term target payload." }
                }
              },
              example: {
                type: "domain",
                value: "example.com"
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Job successfully queued inside Sentinel background scheduler.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jobId: { type: "string" },
                    status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] }
                  }
                },
                example: {
                  jobId: "job_inv_8da21b3c9",
                  status: "queued"
                }
              }
            }
          },
          "400": {
            $ref: "#/components/responses/BadRequest"
          },
          "401": {
            $ref: "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/investigations/{jobId}": {
      get: {
        summary: "Poll Investigation Job Status",
        description: "Retrieves status, execution progress, logs, and compiled target intelligence report when completed.",
        operationId: "getInvestigationJob",
        tags: ["Investigation Jobs"],
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Background job identifier"
          }
        ],
        responses: {
          "200": {
            description: "Job state successfully returned.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvestigationJob"
                },
                example: {
                  id: "job_inv_8da21b3c9",
                  jobId: "job_inv_8da21b3c9",
                  userId: "usr_sentinel_94921",
                  status: "completed",
                  progress: 100,
                  type: "domain",
                  query: "example.com",
                  startedAt: "2026-07-12T04:01:00Z",
                  completedAt: "2026-07-12T04:01:03Z",
                  resultId: "res_job_inv_8da21b3c9",
                  report: {
                    summary: "Strategic scans completed on example.com.",
                    executiveSummary: "Target shows standard domain infrastructure footprint.",
                    entities: [],
                    relationships: [],
                    canonicalEntities: [],
                    timeline: [],
                    confidence: 85,
                    riskScore: 5,
                    sources: [],
                    evidences: []
                  }
                }
              }
            }
          },
          "404": {
            $ref: "#/components/responses/NotFound"
          }
        }
      }
    },
    "/history": {
      get: {
        summary: "Fetch Paginated Search History",
        description: "Returns past completed scans for visual reporting. Supports offset-based pagination.",
        operationId: "getHistory",
        tags: ["Reports & History"],
        parameters: [
          {
            name: "page",
            in: "query",
            required: false,
            schema: { type: "integer", default: 1 },
            description: "Page index to retrieve"
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 10 },
            description: "Number of records returning per page"
          }
        ],
        responses: {
          "200": {
            description: "History records fetched successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    history: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          userId: { type: "string" },
                          type: { type: "string" },
                          query: { type: "string" },
                          summary: { type: "string" },
                          confidence: { type: "integer" },
                          createdAt: { type: "string" }
                        }
                      }
                    },
                    pagination: {
                      type: "object",
                      properties: {
                        total: { type: "integer" },
                        page: { type: "integer" },
                        limit: { type: "integer" },
                        pages: { type: "integer" }
                      }
                    }
                  }
                },
                example: {
                  history: [
                    {
                      id: "inv_9da21bc",
                      userId: "usr_sentinel_94921",
                      type: "domain",
                      query: "openai.com",
                      summary: "Strategic scans completed on openai.com. Confirmed defensive domain setup.",
                      confidence: 95,
                      createdAt: "2026-07-11T04:12:00Z"
                    }
                  ],
                  pagination: {
                    total: 1,
                    page: 1,
                    limit: 10,
                    pages: 1
                  }
                }
              }
            }
          },
          "401": {
            $ref: "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/reports/{id}": {
      get: {
        summary: "Retrieve Full Investigation Report",
        description: "Fetches detailed intelligence graphs, nodes, evidence tracks, and timelines by target index ID.",
        operationId: "getReportDetails",
        tags: ["Reports & History"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "The historical investigation unique ID"
          }
        ],
        responses: {
          "200": {
            description: "Full intelligence schema report payload returned.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvestigationResult"
                },
                example: {
                  summary: "Strategic scans completed on openai.com.",
                  executiveSummary: "Target exhibits a defensive, highly robust structural infrastructure with validated DNS mappings.",
                  entities: [],
                  relationships: [],
                  canonicalEntities: [],
                  timeline: [],
                  confidence: 95,
                  riskScore: 12,
                  sources: [],
                  evidences: []
                }
              }
            }
          },
          "404": {
            $ref: "#/components/responses/NotFound"
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "Custom key supplied as X-API-Key header credential."
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Bearer authorization token header containing standard API Key."
      }
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          companyName: { type: "string" },
          plan: { type: "string" },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          secret: { type: "string" },
          status: { type: "string", enum: ["active", "revoked"] },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          requestCount: { type: "integer" },
          rateLimit: { type: "integer" }
        }
      },
      InvestigationJob: {
        type: "object",
        properties: {
          id: { type: "string" },
          jobId: { type: "string" },
          userId: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
          progress: { type: "integer" },
          type: { type: "string" },
          query: { type: "string" },
          startedAt: { type: "string" },
          completedAt: { type: "string", nullable: true },
          error: { type: "string", nullable: true },
          resultId: { type: "string", nullable: true },
          report: { type: "object", nullable: true }
        }
      },
      InvestigationResult: {
        type: "object",
        properties: {
          summary: { type: "string" },
          executiveSummary: { type: "string" },
          entities: { type: "array", items: { type: "object" } },
          relationships: { type: "array", items: { type: "object" } },
          canonicalEntities: { type: "array", items: { type: "object" } },
          timeline: { type: "array", items: { type: "object" } },
          confidence: { type: "integer" },
          riskScore: { type: "integer", nullable: true },
          sources: { type: "array", items: { type: "object" } },
          evidences: { type: "array", items: { type: "object" } }
        }
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          details: { type: "string", nullable: true }
        }
      }
    },
    responses: {
      BadRequest: {
        description: "Bad or incomplete request payload schema.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Validation check failed: query value/term parameter is required." }
          }
        }
      },
      Unauthorized: {
        description: "Authentication failed. Missing or inactive API credentials.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Access Denied. A valid X-API-Key or Bearer token is required." }
          }
        }
      },
      NotFound: {
        description: "Target job, key, or entity was not found.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "The requested entity key was not found." }
          }
        }
      },
      InternalError: {
        description: "Server/API processor pipeline error.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Threat intelligence engine failed to complete analysis due to network timeouts." }
          }
        }
      }
    }
  }
};
