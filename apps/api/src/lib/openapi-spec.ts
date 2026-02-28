/**
 * OpenAPI 3.0.0 spec for the Numen ChatGPT Action.
 * Uses 3.0.0 for maximum ChatGPT GPT Action compatibility.
 */
export function buildOpenApiSpec(apiBaseUrl: string) {
  return {
    openapi: "3.0.0",
    info: {
      title: "Numen Meal Planner API",
      description: "Push meal plans from ChatGPT into Numen. Look up clients and menu items, then push a weekly meal plan.",
      version: "1.0.0",
    },
    servers: [{ url: apiBaseUrl }],
    paths: {
      "/v1/clients": {
        get: {
          operationId: "listClients",
          summary: "List all active clients",
          description: "Returns the list of clients you can schedule meals for.",
          responses: {
            "200": {
              description: "Client list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ClientListResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/skus": {
        get: {
          operationId: "listMenuItems",
          summary: "List available menu items (SKUs)",
          description: "Returns all active menu items (SKUs) with their codes and names.",
          responses: {
            "200": {
              description: "SKU list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SkuListResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/meal-plans/push": {
        post: {
          operationId: "pushMealPlan",
          summary: "Push a meal plan",
          description: "Create meal schedules for one or more days. Unmatched meal names auto-create placeholder SKUs. Duplicates are skipped.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MealPlanPushRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Push result",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MealPlanPushResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ClientListResponse: {
          type: "object" as const,
          properties: {
            clients: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  id: { type: "string" as const },
                  fullName: { type: "string" as const },
                },
              },
            },
          },
        },
        SkuListResponse: {
          type: "object" as const,
          properties: {
            skus: {
              type: "array" as const,
              items: {
                type: "object" as const,
                properties: {
                  code: { type: "string" as const },
                  name: { type: "string" as const },
                },
              },
            },
          },
        },
        MealPlanPushRequest: {
          type: "object" as const,
          required: ["meals"],
          properties: {
            meals: {
              type: "array" as const,
              description: "Array of meals to schedule",
              items: {
                type: "object" as const,
                required: ["clientName", "mealName", "serviceDate", "mealSlot"],
                properties: {
                  clientName: { type: "string" as const, description: "Client full name" },
                  mealName: { type: "string" as const, description: "Meal or dish name" },
                  serviceDate: { type: "string" as const, description: "YYYY-MM-DD" },
                  mealSlot: {
                    type: "string" as const,
                    enum: ["breakfast", "lunch", "dinner", "snack", "pre_training", "post_training", "pre_bed"],
                  },
                  servings: { type: "number" as const, description: "Number of servings (default 1)" },
                  notes: { type: "string" as const, description: "Optional notes" },
                },
              },
            },
          },
        },
        MealPlanPushResponse: {
          type: "object" as const,
          properties: {
            created: { type: "integer" as const, description: "Meals created" },
            skipped: { type: "integer" as const, description: "Duplicates skipped" },
            skusCreated: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Auto-created SKU names",
            },
            errors: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Errors encountered",
            },
          },
        },
      },
      securitySchemes: {
        BearerAuth: {
          type: "http" as const,
          scheme: "bearer",
        },
      },
    },
    security: [{ BearerAuth: [] as string[] }],
  };
}
