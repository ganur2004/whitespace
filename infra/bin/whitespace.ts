import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { REPO_ROOT, WhitespaceStack } from "../lib/whitespace-stack.js";

const app = new App();

const context = (name: string): string | undefined => {
  const value: unknown = app.node.tryGetContext(name);
  return value === undefined || value === "" ? undefined : String(value);
};

const keysSecretName = context("keysSecret");
const anthropicModel = context("anthropicModel");
const budgetEmail = context("budgetEmail");
const demoMode = context("demoMode");

new WhitespaceStack(app, context("stackName") ?? "Whitespace", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: context("region") ?? "ap-southeast-2",
  },
  description: "Whitespace: the API on Lambda behind CloudFront, the web app on S3",
  demoMode: demoMode === undefined ? !keysSecretName : demoMode === "true",
  ...(keysSecretName ? { keysSecretName } : {}),
  ...(anthropicModel ? { anthropicModel } : {}),
  siteAssets: join(REPO_ROOT, "web", "dist"),
  ...(budgetEmail ? { budgetEmail } : {}),
  budgetLimitUsd: Number(context("budgetLimit") ?? "20"),
});
