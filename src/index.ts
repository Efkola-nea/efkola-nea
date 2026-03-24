import fs from "node:fs/promises";
import OpenAI from "openai";
import { runPipeline } from "./pipeline/runPipeline.js";
import { createLogger } from "./utils/logger.js";

interface CliArgs {
  inputFile?: string;
  outputFile?: string;
  example: boolean;
  disableValidator: boolean;
  disableRepair: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    example: false,
    disableValidator: false,
    disableRepair: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--example") {
      args.example = true;
      continue;
    }
    if (arg === "--disable-validator") {
      args.disableValidator = true;
      continue;
    }
    if (arg === "--disable-repair") {
      args.disableRepair = true;
      continue;
    }
    if (arg === "--input-file" && argv[index + 1]) {
      args.inputFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output-file" && argv[index + 1]) {
      args.outputFile = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const logger = createLogger("cli", (process.env.LOG_LEVEL as any) ?? "info");

  const inputFile = args.example ? "examples/source-article.txt" : args.inputFile;
  if (!inputFile) {
    throw new Error(
      "Missing input. Use --input-file <path> or --example. Optional flags: --disable-validator --disable-repair",
    );
  }

  const sourceArticle = await fs.readFile(inputFile, "utf8");

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const output = await runPipeline({
    client,
    sourceArticle,
    logger: logger.child("pipeline"),
    featureFlags: {
      enableValidator: !args.disableValidator,
      enableRepair: !args.disableRepair,
    },
  });

  const json = JSON.stringify(output, null, 2);
  if (args.outputFile) {
    await fs.writeFile(args.outputFile, json, "utf8");
    logger.info("Saved output", { outputFile: args.outputFile });
  } else {
    // eslint-disable-next-line no-console
    console.log(json);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
