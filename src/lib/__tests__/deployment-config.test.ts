import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts: Record<string, string>;
};

type VercelJson = {
  buildCommand: string;
};

function readJson<T>(fileName: string): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), fileName), "utf8"),
  ) as T;
}

describe("deployment configuration", () => {
  it("provides an explicit committed-migration command", () => {
    const packageJson = readJson<PackageJson>("package.json");

    expect(packageJson.scripts["db:migrate"]).toBe("drizzle-kit migrate");
  });

  it("keeps the package Vercel build entry point schema-safe", () => {
    const packageJson = readJson<PackageJson>("package.json");

    expect(packageJson.scripts["vercel-build"]).toBe("npm run build");
    expect(packageJson.scripts["vercel-build"]).not.toContain("db:push");
  });

  it("keeps the Vercel build command schema-safe", () => {
    const vercelJson = readJson<VercelJson>("vercel.json");

    expect(vercelJson.buildCommand).toBe("npm run build");
    expect(vercelJson.buildCommand).not.toContain("db:push");
  });

  it("documents migration-ledger adoption before migrating existing pushed databases", () => {
    const deploymentGuide = readFileSync(
      join(process.cwd(), "docs/deployment.md"),
      "utf8",
    );

    expect(deploymentGuide).toContain("Existing databases created by `db:push`");
    expect(deploymentGuide).toContain("Do not run `npm run db:migrate`");
    expect(deploymentGuide).toContain("__drizzle_migrations");
    expect(deploymentGuide).toContain("exact deployed revision");
    expect(deploymentGuide).toContain("backup or restore point");
    expect(deploymentGuide).toContain("reviewed release revision");
  });
});
