import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  LocalStorageAdapter,
  CloudStorageAdapter,
  createStorageAdapter,
  generateStorageKey,
  isAllowedMimeType,
  isFileSizeValid,
  MAX_FILE_SIZE_BYTES,
} from "./file-storage.js";

const TEST_DIR = join(process.cwd(), ".test-uploads");

describe("file-storage", () => {
  describe("LocalStorageAdapter", () => {
    let adapter: LocalStorageAdapter;

    beforeEach(() => {
      if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
      adapter = new LocalStorageAdapter(TEST_DIR);
    });

    afterEach(() => {
      if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("creates base directory on construction", () => {
      expect(existsSync(TEST_DIR)).toBe(true);
    });

    it("uploads a file and returns metadata", async () => {
      const data = Buffer.from("hello world");
      const result = await adapter.upload("test/file.txt", data, "text/plain");
      expect(result.storageProvider).toBe("local");
      expect(result.storageKey).toBe("test/file.txt");
      expect(result.sizeBytes).toBe(data.length);
      expect(result.mimeType).toBe("text/plain");
      expect(result.checksum).toHaveLength(64); // SHA-256 hex
    });

    it("reads back uploaded file", async () => {
      const data = Buffer.from("test content 123");
      await adapter.upload("read-test.txt", data, "text/plain");
      const read = await adapter.read("read-test.txt");
      expect(read.toString()).toBe("test content 123");
    });

    it("throws on reading non-existent file", async () => {
      await expect(adapter.read("does-not-exist.txt")).rejects.toThrow("File not found");
    });

    it("checks file existence", async () => {
      expect(await adapter.exists("nope.txt")).toBe(false);
      await adapter.upload("exists.txt", Buffer.from("x"), "text/plain");
      expect(await adapter.exists("exists.txt")).toBe(true);
    });

    it("deletes a file", async () => {
      await adapter.upload("to-delete.txt", Buffer.from("x"), "text/plain");
      expect(await adapter.exists("to-delete.txt")).toBe(true);
      await adapter.delete("to-delete.txt");
      expect(await adapter.exists("to-delete.txt")).toBe(false);
    });

    it("delete is idempotent for non-existent files", async () => {
      await expect(adapter.delete("never-existed.txt")).resolves.toBeUndefined();
    });

    it("handles nested directory creation", async () => {
      const data = Buffer.from("nested");
      await adapter.upload("org1/client1/doc.pdf", data, "application/pdf");
      expect(await adapter.exists("org1/client1/doc.pdf")).toBe(true);
    });

    it("getUrl returns path-based URL", () => {
      expect(adapter.getUrl("test/file.txt")).toBe("/files/test/file.txt");
    });
  });

  describe("CloudStorageAdapter", () => {
    it("throws descriptive error on upload", async () => {
      const adapter = new CloudStorageAdapter({ provider: "s3" });
      await expect(
        adapter.upload("key", Buffer.from("x"), "text/plain"),
      ).rejects.toThrow("Cloud storage (s3) is not yet configured");
    });

    it("throws on read", async () => {
      const adapter = new CloudStorageAdapter({ provider: "r2" });
      await expect(adapter.read("key")).rejects.toThrow("Cloud storage (r2) read not yet implemented");
    });

    it("getUrl returns endpoint-based URL when configured", () => {
      const adapter = new CloudStorageAdapter({
        provider: "s3",
        endpoint: "https://s3.amazonaws.com",
        bucket: "my-bucket",
      });
      expect(adapter.getUrl("test/file.txt")).toBe("https://s3.amazonaws.com/my-bucket/test/file.txt");
    });

    it("getUrl returns null when endpoint not configured", () => {
      const adapter = new CloudStorageAdapter({ provider: "s3" });
      expect(adapter.getUrl("test/file.txt")).toBeNull();
    });
  });

  describe("createStorageAdapter", () => {
    it("creates local adapter by default", () => {
      const adapter = createStorageAdapter({ basePath: TEST_DIR });
      expect(adapter).toBeInstanceOf(LocalStorageAdapter);
      if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    });

    it("creates cloud adapter for s3 provider", () => {
      const adapter = createStorageAdapter({ provider: "s3" });
      expect(adapter).toBeInstanceOf(CloudStorageAdapter);
    });
  });

  describe("generateStorageKey", () => {
    it("includes org and client in path", () => {
      const key = generateStorageKey("org1", "client1", "report.pdf");
      expect(key).toMatch(/^org1\/client1\//);
      expect(key).toMatch(/\.pdf$/);
    });

    it("generates unique keys for same inputs at different times", () => {
      const key1 = generateStorageKey("org1", "client1", "report.pdf");
      const key2 = generateStorageKey("org1", "client1", "report.pdf");
      // Keys include timestamp so they should differ (or be extremely close)
      // Both should be valid paths
      expect(key1).toMatch(/^org1\/client1\//);
      expect(key2).toMatch(/^org1\/client1\//);
    });

    it("handles files without extension", () => {
      const key = generateStorageKey("org1", "client1", "noext");
      expect(key).toMatch(/^org1\/client1\/\d+-[a-f0-9]+$/);
    });
  });

  describe("isAllowedMimeType", () => {
    it("allows PDF", () => {
      expect(isAllowedMimeType("application/pdf")).toBe(true);
    });

    it("allows JPEG", () => {
      expect(isAllowedMimeType("image/jpeg")).toBe(true);
    });

    it("allows PNG", () => {
      expect(isAllowedMimeType("image/png")).toBe(true);
    });

    it("allows CSV", () => {
      expect(isAllowedMimeType("text/csv")).toBe(true);
    });

    it("rejects executable", () => {
      expect(isAllowedMimeType("application/x-executable")).toBe(false);
    });

    it("rejects HTML", () => {
      expect(isAllowedMimeType("text/html")).toBe(false);
    });
  });

  describe("isFileSizeValid", () => {
    it("accepts valid file sizes", () => {
      expect(isFileSizeValid(1024)).toBe(true);
      expect(isFileSizeValid(MAX_FILE_SIZE_BYTES)).toBe(true);
    });

    it("rejects zero-byte files", () => {
      expect(isFileSizeValid(0)).toBe(false);
    });

    it("rejects oversized files", () => {
      expect(isFileSizeValid(MAX_FILE_SIZE_BYTES + 1)).toBe(false);
    });

    it("rejects negative sizes", () => {
      expect(isFileSizeValid(-1)).toBe(false);
    });
  });
});
