import crypto from "node:crypto";
import { addHours } from "date-fns";
import { prisma } from "@nutrition/db";
import { getGmailClient } from "./gmail-client.js";
import {
  parseInstacartEmailHtml,
  isInstacartOrderEmail,
  type ParsedInstacartOrder,
} from "./instacart-email-parser.js";

/**
 * Sync Instacart order emails from Gmail for a given integration.
 * Searches for Instacart order emails since lastSyncAt, parses them,
 * and imports items into the existing Instacart pipeline.
 */
export async function syncGmailOrders(integrationId: string): Promise<{
  emailsScanned: number;
  ordersImported: number;
  ordersSkipped: number;
  errors: string[];
}> {
  const integration = await prisma.gmailIntegration.findUnique({
    where: { id: integrationId },
    include: { organization: true },
  });

  if (!integration || !integration.active) {
    throw new Error("Gmail integration not found or inactive");
  }

  // Mark as syncing
  await prisma.gmailIntegration.update({
    where: { id: integrationId },
    data: { syncStatus: "SYNCING", syncError: null },
  });

  const result = { emailsScanned: 0, ordersImported: 0, ordersSkipped: 0, errors: [] as string[] };

  try {
    const gmail = getGmailClient(integration.refreshToken);

    // Build search query — look for Instacart emails since last sync
    const afterDate = integration.lastSyncAt
      ? Math.floor(integration.lastSyncAt.getTime() / 1000)
      : Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000); // default: last 30 days

    const query = `from:instacart.com subject:(order OR delivery OR receipt) after:${afterDate}`;

    // Search for matching emails
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
    });

    const messages = listRes.data.messages || [];
    result.emailsScanned = messages.length;

    for (const msg of messages) {
      if (!msg.id) continue;

      try {
        // Get the full email
        const email = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });

        const headers = email.data.payload?.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
        const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value || "";
        const dateHeader = headers.find((h) => h.name?.toLowerCase() === "date")?.value || "";
        const messageId = email.data.id || msg.id;

        // Skip non-order emails
        if (!isInstacartOrderEmail(subject, from)) continue;

        // Extract HTML body
        const htmlBody = extractHtmlBody(email.data.payload);
        if (!htmlBody) {
          result.errors.push(`Could not extract HTML body from email: ${subject}`);
          continue;
        }

        // Parse order from HTML
        const receivedDate = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
        const parsed = parseInstacartEmailHtml(htmlBody, subject, messageId, receivedDate);

        if (!parsed || parsed.items.length === 0) {
          result.errors.push(`Could not parse items from email: ${subject}`);
          continue;
        }

        // Check dedup — skip if we already have an import with this checksum
        const existingImport = await prisma.importJob.findFirst({
          where: {
            organizationId: integration.organizationId,
            jobType: "INSTACART_ORDER",
            sourceChecksum: parsed.dedupKey,
          },
        });

        if (existingImport) {
          result.ordersSkipped++;
          continue;
        }

        // Import the order
        await importParsedOrder(parsed, integration.organizationId);
        result.ordersImported++;
      } catch (emailErr: any) {
        result.errors.push(`Error processing email ${msg.id}: ${emailErr.message}`);
      }
    }

    // Update integration status
    await prisma.gmailIntegration.update({
      where: { id: integrationId },
      data: {
        syncStatus: "IDLE",
        lastSyncAt: new Date(),
        syncError: result.errors.length > 0 ? result.errors.join("; ") : null,
      },
    });

    // Create sync log
    await prisma.gmailSyncLog.create({
      data: {
        gmailIntegrationId: integrationId,
        emailsScanned: result.emailsScanned,
        ordersImported: result.ordersImported,
        ordersSkipped: result.ordersSkipped,
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    });

    return result;
  } catch (err: any) {
    // Mark as failed
    await prisma.gmailIntegration.update({
      where: { id: integrationId },
      data: {
        syncStatus: "FAILED",
        syncError: err.message,
      },
    });

    throw err;
  }
}

/**
 * Import a parsed Instacart order into the system.
 * Creates an ImportJob for tracking, then for each item:
 * 1. Finds or creates an IngredientCatalog entry (auto-mapped by product name)
 * 2. Upserts a ProductCatalog entry
 * 3. Creates an InventoryLot + ledger entry
 * Unmatched items create verification tasks for manual review.
 */
async function importParsedOrder(
  order: ParsedInstacartOrder,
  organizationId: string
): Promise<void> {
  // Create import job to track this order
  const job = await prisma.importJob.create({
    data: {
      organizationId,
      jobType: "INSTACART_ORDER",
      mode: "COMMIT",
      status: "RUNNING",
      sourceFileName: `gmail-instacart-${order.orderRef}`,
      sourceChecksum: order.dedupKey,
      summary: {
        source: "gmail",
        orderRef: order.orderRef,
        orderDate: order.orderDate,
        itemCount: order.items.length,
        totalAmount: order.totalAmount,
      },
      createdBy: "gmail-sync",
    },
  });

  let importedCount = 0;

  try {
    // Load existing ingredients for matching
    const ingredients = await prisma.ingredientCatalog.findMany({
      where: { organizationId, active: true },
    });

    const orderedAt = order.orderDate ? new Date(order.orderDate) : new Date();

    for (const item of order.items) {
      // Try to find an existing ingredient by name (case-insensitive)
      const normalizedName = item.productName.toLowerCase().trim();
      let ingredient = ingredients.find(
        (ing) => ing.name.toLowerCase() === normalizedName
      );

      if (!ingredient) {
        // Auto-create ingredient with a review task
        const canonicalKey = normalizedName
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60);

        ingredient = await prisma.ingredientCatalog.create({
          data: {
            organizationId,
            canonicalKey: canonicalKey || `gmail-${Date.now()}`,
            name: item.productName,
            category: "UNMAPPED",
            defaultUnit: "g",
            allergenTags: [],
            createdBy: "gmail-sync",
          },
        });
        ingredients.push(ingredient);

        // Create a verification task so the user reviews this auto-created ingredient
        await prisma.verificationTask.create({
          data: {
            organizationId,
            taskType: "SOURCE_RETRIEVAL",
            severity: "MEDIUM",
            status: "OPEN",
            title: `Review Gmail-imported ingredient: ${item.productName}`,
            description: `Auto-created from Instacart order email (${order.orderRef}). Needs category and allergen review.`,
            payload: {
              ingredientId: ingredient.id,
              canonicalKey: ingredient.canonicalKey,
              source: "gmail_instacart_sync",
            },
            createdBy: "gmail-sync",
          },
        });
      }

      // Upsert product catalog
      const upcKey = `GMAIL-${ingredient.id}-${normalizedName}`.slice(0, 100);
      const product = await prisma.productCatalog.upsert({
        where: {
          organizationId_upc: { organizationId, upc: upcKey },
        },
        update: {
          name: item.productName,
          vendor: "Instacart-Gmail",
          version: { increment: 1 },
        },
        create: {
          organizationId,
          ingredientId: ingredient.id,
          name: item.productName,
          brand: "Instacart",
          upc: upcKey,
          vendor: "Instacart-Gmail",
          createdBy: "gmail-sync",
        },
      });

      // Create inventory lot
      // Since we don't have exact grams from emails, estimate 1 unit = 100g
      const estimatedGrams = item.quantity * 100;
      const unitCostCents = Math.round(item.unitPrice * 100);

      const lot = await prisma.inventoryLot.create({
        data: {
          organizationId,
          productId: product.id,
          receivedAt: orderedAt,
          expiresAt: addHours(orderedAt, 24 * 10),
          quantityReceivedG: estimatedGrams,
          quantityAvailableG: estimatedGrams,
          unitCostCents,
          sourceOrderRef: `gmail:${order.orderRef}`,
          createdBy: "gmail-sync",
        },
      });

      // Create ledger entry
      await prisma.inventoryLotLedger.create({
        data: {
          inventoryLotId: lot.id,
          deltaG: estimatedGrams,
          reason: "GMAIL_INSTACART_IMPORT",
          referenceId: job.id,
          createdBy: "gmail-sync",
        },
      });

      importedCount++;
    }

    // Mark job as succeeded
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        summary: {
          source: "gmail",
          orderRef: order.orderRef,
          orderDate: order.orderDate,
          itemCount: order.items.length,
          importedCount,
          totalAmount: order.totalAmount,
        },
      },
    });
  } catch (err) {
    // Mark job as failed
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED" },
    });
    throw err;
  }
}

/**
 * Extract HTML body from a Gmail message payload (handles multipart).
 */
function extractHtmlBody(payload: any): string | null {
  if (!payload) return null;

  // Direct HTML body
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  // Multipart — recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      const html = extractHtmlBody(part);
      if (html) return html;
    }
  }

  return null;
}
