import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { WhitespaceStack, type WhitespaceStackProps } from "../lib/whitespace-stack.js";

function synth(props: Partial<WhitespaceStackProps> = {}): Template {
  const site = mkdtempSync(join(tmpdir(), "whitespace-site-"));
  mkdirSync(join(site, "assets"));
  writeFileSync(join(site, "index.html"), "<title>Whitespace</title>");
  writeFileSync(join(site, "assets", "app.js"), "");
  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const stack = new WhitespaceStack(app, "Test", {
    env: { account: "123456789012", region: "ap-southeast-2" },
    demoMode: false,
    keysSecretName: "whitespace/keys",
    siteAssets: site,
    budgetLimitUsd: 20,
    ...props,
  });
  return Template.fromStack(stack);
}

const api = (template: Template) => {
  const [fn] = Object.values(
    template.findResources("AWS::Lambda::Function", {
      Properties: {
        Environment: { Variables: Match.objectLike({ FIXTURES_DIR: "/var/task/fixtures" }) },
      },
    }),
  ) as { Properties: { Environment: { Variables: Record<string, unknown> } } }[];
  return fn!.Properties.Environment.Variables;
};

describe("WhitespaceStack", () => {
  it("streams the API through a function URL", () => {
    synth().hasResourceProperties("AWS::Lambda::Url", {
      AuthType: "NONE",
      InvokeMode: "RESPONSE_STREAM",
    });
  });

  it("routes /api/* and /health to the API without caching or compression", () => {
    const template = synth();
    const behavior = (path: string) =>
      Match.objectLike({
        PathPattern: path,
        CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
        Compress: false,
        AllowedMethods: Match.arrayWith(["POST"]),
      });
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([behavior("/api/*"), behavior("/health")]),
        Origins: Match.arrayWith([
          Match.objectLike({
            OriginCustomHeaders: [Match.objectLike({ HeaderName: "x-origin-secret" })],
          }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::CloudFront::OriginRequestPolicy", {
      OriginRequestPolicyConfig: Match.objectLike({
        HeadersConfig: {
          HeaderBehavior: "whitelist",
          Headers: Match.arrayWith(["cloudfront-viewer-address"]),
        },
      }),
    });
  });

  it("keeps the keys out of the template and caches Qloo in S3", () => {
    const env = api(synth());
    expect(env.QLOO_API_KEY).toBe(
      "{{resolve:secretsmanager:whitespace/keys:SecretString:QLOO_API_KEY::}}",
    );
    expect(env.ANTHROPIC_API_KEY).toBe(
      "{{resolve:secretsmanager:whitespace/keys:SecretString:ANTHROPIC_API_KEY::}}",
    );
    expect(JSON.stringify(env.ORIGIN_SECRET)).toContain("{{resolve:secretsmanager:");
    expect(env.QLOO_CACHE_BUCKET).toEqual({ Ref: expect.stringMatching(/^CacheBucket/) });
    expect(env.DEMO_MODE).toBe("false");
  });

  it("runs on demo data without a keys secret", () => {
    const env = api(synth({ demoMode: true, keysSecretName: undefined }));
    expect(env.DEMO_MODE).toBe("true");
    expect(env).not.toHaveProperty("QLOO_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("adds a budget alert only when an address is given", () => {
    synth().resourceCountIs("AWS::Budgets::Budget", 0);
    synth({ budgetEmail: "team@example.com" }).resourceCountIs("AWS::Budgets::Budget", 1);
  });
});
