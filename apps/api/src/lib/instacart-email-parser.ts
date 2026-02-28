import crypto from "node:crypto";

export interface ParsedInstacartItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ParsedInstacartOrder {
  orderRef: string;
  orderDate: string;
  items: ParsedInstacartItem[];
  totalAmount: number;
  dedupKey: string;
}

/**
 * Attempts to extract the Instacart order reference from the email subject.
 * Subjects typically look like:
 *   "Your Instacart order with Costco is complete"
 *   "Your Instacart order is on the way"
 *   "Your delivery from Costco has been completed"
 */
function extractOrderRef(subject: string, messageId: string): string {
  // Use message ID as fallback reference since Instacart subjects don't include order numbers
  return messageId || `INSTA-${Date.now()}`;
}

/**
 * Parse an Instacart order confirmation email HTML body.
 *
 * Instacart emails have various formats. This parser handles the most common
 * confirmation format with item tables containing product name, qty, price.
 *
 * Since Instacart changes their HTML format frequently, this parser uses
 * multiple strategies:
 * 1. Look for table-based layouts with price-like patterns
 * 2. Fallback to regex-based extraction
 */
export function parseInstacartEmailHtml(
  html: string,
  subject: string,
  messageId: string,
  receivedDate: string
): ParsedInstacartOrder | null {
  if (!html || html.length < 100) return null;

  const items: ParsedInstacartItem[] = [];

  // Strategy 1: Find rows with product names and prices using common patterns
  // Look for price patterns like $X.XX or $XX.XX
  const pricePattern = /\$(\d{1,3}(?:,\d{3})*\.\d{2})/g;
  const allPrices = [...html.matchAll(pricePattern)].map((m) => parseFloat(m[1]!.replace(",", "")));

  // Strategy 2: Look for table rows or divs that contain item-like structures
  // Common pattern: <td>Product Name</td> ... <td>$X.XX</td>
  const tdPattern = /<td[^>]*>([^<]{3,80})<\/td>\s*(?:<td[^>]*>[^<]*<\/td>\s*)*<td[^>]*>\s*\$(\d+\.\d{2})\s*<\/td>/gi;
  let tdMatch;

  while ((tdMatch = tdPattern.exec(html)) !== null) {
    const name = tdMatch[1]!.trim();
    const price = parseFloat(tdMatch[2]!);

    // Skip headers, totals, and other non-item rows
    if (
      /subtotal|total|tax|tip|fee|delivery|service|saving|discount|promo|order|date|time|item|product|description|qty|quantity|price|amount/i.test(name)
    ) {
      continue;
    }

    // Skip very short names (likely codes/ids) or very long ones (likely HTML artifacts)
    if (name.length < 3 || name.length > 80) continue;

    items.push({
      productName: decodeHtmlEntities(name),
      quantity: 1,
      unitPrice: price,
      lineTotal: price,
    });
  }

  // Strategy 3: If no table matches, try div/span patterns
  if (items.length === 0) {
    // Look for product blocks: text followed by price
    const blockPattern = /(?:class="[^"]*item[^"]*"[^>]*>|class="[^"]*product[^"]*"[^>]*>)\s*(?:<[^>]+>)*\s*([^<]{3,80})\s*(?:<[^>]+>)*\s*\$(\d+\.\d{2})/gi;
    let blockMatch;

    while ((blockMatch = blockPattern.exec(html)) !== null) {
      const name = blockMatch[1]!.trim();
      const price = parseFloat(blockMatch[2]!);

      if (/subtotal|total|tax|tip|fee|delivery|service/i.test(name)) continue;
      if (name.length < 3 || name.length > 80) continue;

      items.push({
        productName: decodeHtmlEntities(name),
        quantity: 1,
        unitPrice: price,
        lineTotal: price,
      });
    }
  }

  if (items.length === 0) return null;

  // Calculate total from items (the email total might include fees/tax)
  const itemTotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  // Try to find the email's stated total
  const totalMatch = html.match(/(?:order\s*)?total[^$]*\$(\d+\.\d{2})/i);
  const totalAmount = totalMatch ? parseFloat(totalMatch[1]!) : itemTotal;

  // Generate dedup key from subject + date
  const dedupKey = crypto
    .createHash("sha256")
    .update(`${subject}|${receivedDate}`)
    .digest("hex");

  return {
    orderRef: extractOrderRef(subject, messageId),
    orderDate: receivedDate,
    items,
    totalAmount,
    dedupKey,
  };
}

/**
 * Check if an email subject looks like an Instacart order confirmation.
 */
export function isInstacartOrderEmail(subject: string, from: string): boolean {
  const isFromInstacart =
    from.toLowerCase().includes("instacart") ||
    from.toLowerCase().includes("@instacart.com");

  const isOrderSubject =
    /order.*(?:complete|deliver|ready|confirm|receipt)/i.test(subject) ||
    /(?:complete|deliver|ready|confirm|receipt).*order/i.test(subject) ||
    /your.*delivery.*(?:has been|is)/i.test(subject) ||
    /receipt.*for.*order/i.test(subject);

  return isFromInstacart && isOrderSubject;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
}
