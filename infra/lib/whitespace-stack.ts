import { join } from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export const REPO_ROOT = join(import.meta.dirname, "..", "..");
export const ORIGIN_SECRET_HEADER = "x-origin-secret";

const ESM_REQUIRE_SHIM = [
  "import { createRequire as topLevelCreateRequire } from 'module';",
  "const require = topLevelCreateRequire(import.meta.url);",
].join(" ");

const COPY_DIR = `node -e "require('node:fs').cpSync(process.argv[1], process.argv[2], { recursive: true })"`;

export interface WhitespaceStackProps extends StackProps {
  demoMode: boolean;
  keysSecretName?: string;
  anthropicModel?: string;
  siteAssets: string;
  budgetEmail?: string;
  budgetLimitUsd: number;
}

export class WhitespaceStack extends Stack {
  constructor(scope: Construct, id: string, props: WhitespaceStackProps) {
    super(scope, id, props);

    const siteBucket = this.privateBucket("SiteBucket");
    const cacheBucket = this.privateBucket("CacheBucket");

    const originSecret = new secretsmanager.Secret(this, "OriginSecret", {
      description:
        "Header value that lets CloudFront, and only CloudFront, call the Whitespace API",
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    }).secretValue.unsafeUnwrap();

    const key = (field: string): Record<string, string> =>
      props.keysSecretName
        ? {
            [field]: SecretValue.secretsManager(props.keysSecretName, {
              jsonField: field,
            }).unsafeUnwrap(),
          }
        : {};

    const api = new NodejsFunction(this, "Api", {
      entry: join(REPO_ROOT, "api/src/lambda.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(90),
      logGroup: new logs.LogGroup(this, "ApiLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        DEMO_MODE: String(props.demoMode),
        QLOO_CACHE_BUCKET: cacheBucket.bucketName,
        FIXTURES_DIR: "/var/task/fixtures",
        ORIGIN_SECRET: originSecret,
        NODE_OPTIONS: "--enable-source-maps",
        ...key("QLOO_API_KEY"),
        ...key("ANTHROPIC_API_KEY"),
        ...(props.anthropicModel ? { ANTHROPIC_MODEL_ID: props.anthropicModel } : {}),
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        sourceMap: true,
        banner: ESM_REQUIRE_SHIM,
        bundleAwsSDK: true,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `${COPY_DIR} "${join(inputDir, "api", "fixtures")}" "${join(outputDir, "fixtures")}"`,
          ],
        },
      },
    });
    cacheBucket.grantReadWrite(api);

    const apiUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.FunctionUrlOrigin(apiUrl, {
        customHeaders: { [ORIGIN_SECRET_HEADER]: originSecret },
        readTimeout: Duration.seconds(60),
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: new cloudfront.OriginRequestPolicy(this, "ApiRequests", {
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
          "content-type",
          "accept",
          "cloudfront-viewer-address",
        ),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      }),
      compress: false,
    };

    const distribution = new cloudfront.Distribution(this, "Site", {
      comment: "Whitespace",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: { "/api/*": apiBehavior, "/health": apiBehavior },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const assets = new s3deploy.BucketDeployment(this, "SiteAssets", {
      destinationBucket: siteBucket,
      destinationKeyPrefix: "assets/",
      sources: [s3deploy.Source.asset(join(props.siteAssets, "assets"))],
      cacheControl: [s3deploy.CacheControl.fromString("public, max-age=31536000, immutable")],
      prune: false,
    });
    const page = new s3deploy.BucketDeployment(this, "SitePage", {
      destinationBucket: siteBucket,
      sources: [s3deploy.Source.asset(props.siteAssets, { exclude: ["assets"] })],
      cacheControl: [s3deploy.CacheControl.noCache()],
      prune: false,
      distribution,
      distributionPaths: ["/*"],
    });
    page.node.addDependency(assets);

    if (props.budgetEmail) {
      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: `${this.stackName}-monthly`,
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: props.budgetLimitUsd, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail }],
          },
        ],
      });
    }

    new CfnOutput(this, "SiteUrl", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "CacheBucketName", { value: cacheBucket.bucketName });
  }

  private privateBucket(id: string): s3.Bucket {
    return new s3.Bucket(this, id, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
