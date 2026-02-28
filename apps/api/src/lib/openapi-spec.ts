/**
 * OpenAPI 3.1 spec for the Numen ChatGPT Action.
 * Describes the endpoints a Custom GPT needs to push meal plans.
 */
export function buildOpenApiSpec(apiBaseUrl: string) {
  return {
    openapi: "3.1.0",
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
                  schema: {
                    type: "object",
                    properties: {
                      clients: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            fullName: { type: "string" },
                            deliveryAddressHome: { type: "string", nullable: true },
                            deliveryAddressWork: { type: "string", nullable: true },
                          },
                        },
                      },
                    },
                  },
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
          description: "Returns all active menu items (SKUs) with their codes and names. Use the name or code when pushing meal plans.",
          responses: {
            "200": {
              description: "SKU list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      skus: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            code: { type: "string" },
                            name: { type: "string" },
                            servingSizeG: { type: "number", nullable: true },
                          },
                        },
                      },
                    },
                  },
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
          description: "Create meal schedules for one or more days. If a meal name doesn't match an existing menu item, a placeholder SKU is auto-created. Duplicate schedules (same client + date + slot + meal) are skipped.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["meals"],
                  properties: {
                    meals: {
                      type: "array",
                      description: "Array of meals to schedule",
                      items: {
                        type: "object",
                        required: ["clientName", "mealName", "serviceDate", "mealSlot"],
                        properties: {
                          clientName: {
                            type: "string",
                            description: "Client's full name (e.g., 'Alex')",
                          },
                          mealName: {
                            type: "string",
                            description: "Name of the meal/dish (e.g., 'Grilled Chicken & Rice'). Matched against existing SKUs or auto-created.",
                          },
                          serviceDate: {
                            type: "string",
                            format: "date",
                            description: "Date the meal is served (YYYY-MM-DD)",
                          },
                          mealSlot: {
                            type: "string",
                            enum: ["breakfast", "lunch", "dinner", "snack", "pre_training", "post_training", "pre_bed"],
                            description: "Time-of-day slot for the meal",
                          },
                          servings: {
                            type: "number",
                            description: "Number of servings (default: 1)",
                            default: 1,
                          },
                          notes: {
                            type: "string",
                            description: "Optional notes (e.g., 'extra veggies', 'no sauce')",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Push result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      created: { type: "integer", description: "Number of new meal schedules created" },
                      skipped: { type: "integer", description: "Number of duplicate meals skipped" },
                      skusCreated: {
                        type: "array",
                        items: { type: "string" },
                        description: "Names of auto-created placeholder SKUs",
                      },
                      errors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            meal: { type: "string" },
                            error: { type: "string" },
                          },
                        },
                        description: "Any errors encountered",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key for authentication. Get this from your Numen GPT Setup page.",
        },
      },
    },
    security: [{ BearerAuth: [] }],
  };
}
