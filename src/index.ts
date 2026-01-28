import { createLogger, format, transports, Logger } from "winston"
import { z, ZodError, ZodObject } from "zod"
import { jsonrepair } from "jsonrepair"

export const defaultPromptPrefix =
    "- You MUST respond only with valid JSON.\n- Do not include markdown.\n- Do not include explanations.\n- Do not include text outside the JSON.\n- Respond in the language requested by the instruction or the language in which it was written.\n\nOJSON must follow these rules:"

export const defaultRepairPromptPrefix = `The returned JSON is invalid or does not follow the schema.\nCorrect and respond ONLY with valid JSON.`

export const defaultRepairPromptFn = (prefix: string, error: string) => `${prefix}\nError details: ${error}`

export type BuildPromptOptions = {
    prefix?: string
    instruction: string
    schema: ZodObject
    jsonSchemaIndent?: number
}

export type RepairPromptOptions = {
    prefix?: string
    fn?: (promptPrefix: string, error: string) => string
}

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LoggingOptions = {
    enabled?: boolean
    level?: LogLevel
}

export type LsofOptions = {
    defaultMaxRetries?: number
    repairPrompt?: RepairPromptOptions
    logging?: LoggingOptions
}

type GenerateTextResponseOptions<T extends ZodObject> = {
    llmAdapter: (string: string) => Promise<string>
    schema: T
    prompt: string
    prefix?: string
    jsonSchemaIndent?: number
}

export type GenerateJsonOptions<T extends ZodObject> = GenerateTextResponseOptions<T> & {
    retryCount?: number
    maxRetries?: number
}

type ParseJsonOptions = {
    schema: ZodObject
    stringData: string
}

export class LsofJsonParsingError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "LsofJsonParsingError"
    }
}

export type GenerateJsonResult<T extends ZodObject> = {
    metadata: {
        retryCount: number
        wasRepaired: boolean
    }
    data: z.infer<T>
}

export class Lsof {
    readonly defaultMaxRetries: number
    readonly repairPrompt: RepairPromptOptions
    private logger: Logger

    constructor({
        defaultMaxRetries = 3,
        repairPrompt = {
            prefix: defaultRepairPromptPrefix,
            fn: defaultRepairPromptFn,
        },
        logging = {
            enabled: false,
            level: "info",
        },
    }: LsofOptions) {
        this.defaultMaxRetries = defaultMaxRetries
        this.repairPrompt = repairPrompt

        this.logger = createLogger({
            level: logging.level ?? "info",
            silent: !logging.enabled,
            format: format.combine(
                format.timestamp(),
                format.colorize(),
                format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : ""
                    return `[Lsof] [${timestamp}] [${level}]: ${message} ${metaString}`
                }),
            ),
            transports: [new transports.Console()],
        })
    }

    private log(level: LogLevel, message: string, data?: any) {
        this.logger.log(level, message, data)
    }

    private buildPrompt({
        prefix = defaultPromptPrefix,
        instruction,
        schema,
        jsonSchemaIndent = 2,
    }: BuildPromptOptions) {
        const jsonSchema = schema.toJSONSchema()
        const jsonSchemaString = JSON.stringify(jsonSchema, null, jsonSchemaIndent)

        return `${prefix}\n${jsonSchemaString}\nInstruction:\n${instruction}`.trim()
    }

    private async generateTextResponse<T extends ZodObject>({
        llmAdapter,
        prompt,
        schema,
        jsonSchemaIndent,
        prefix,
    }: GenerateTextResponseOptions<T>) {
        this.log("debug", "Generating text response...", { instruction: prompt.slice(0, 100) })

        const jsonPrompt = this.buildPrompt({
            instruction: prompt,
            schema: schema,
            jsonSchemaIndent: jsonSchemaIndent,
            prefix: prefix,
        })

        return await llmAdapter(jsonPrompt)
    }

    private parseJson<T>({ schema, stringData }: ParseJsonOptions): [T, boolean] {
        let parsedData: T
        let wasRepaired = false

        try {
            parsedData = JSON.parse(stringData)

            this.log("debug", "JSON parsed successfully on first attempt")
        } catch (firstError: any) {
            this.log("warn", "JSON parsing failed, attempting repair...", { error: firstError.message })

            try {
                const repaired = jsonrepair(stringData)
                parsedData = JSON.parse(repaired)
                wasRepaired = true

                this.log("info", "JSON repaired successfully")
            } catch (repairError: any) {
                this.log("error", "JSON repair failed", { error: repairError.message })

                throw new LsofJsonParsingError(firstError.message)
            }
        }

        return [schema.parse(parsedData) as T, wasRepaired]
    }

    async generateJson<T extends ZodObject>({
        retryCount = 0,
        maxRetries,
        schema,
        ...rest
    }: GenerateJsonOptions<T>): Promise<GenerateJsonResult<T>> {
        const finalMaxRetries = maxRetries ?? this.defaultMaxRetries

        try {
            this.log("info", "Starting JSON generation", { retryCount, maxRetries: finalMaxRetries })

            const rawResponse = await this.generateTextResponse({ schema: schema, ...rest })
            
            this.log("debug", "Raw LLM response received", { rawResponse })

            const [parsedResponse, wasRepaired] = this.parseJson<z.infer<T>>({
                schema: schema,
                stringData: rawResponse,
            })

            this.log("info", "JSON generation completed successfully")

            return {
                data: parsedResponse,
                metadata: {
                    retryCount: retryCount,
                    wasRepaired: wasRepaired,
                },
            }
        } catch (error: any) {
            if (retryCount < finalMaxRetries) {
                const errorMessage = error instanceof ZodError ? JSON.stringify(z.treeifyError(error)) : error.message

                this.log("warn", "Generation failed, retrying...", {
                    attempt: retryCount + 1,
                    maxRetries: finalMaxRetries,
                    error: errorMessage,
                })

                const repainPromptFn = this.repairPrompt.fn ?? defaultRepairPromptFn

                const repairPrompt = repainPromptFn(this.repairPrompt.prefix ?? defaultRepairPromptPrefix, errorMessage)

                return this.generateJson<T>({
                    ...rest,
                    schema: schema,
                    prompt: `${rest.prompt}\n\n${repairPrompt}`,
                    retryCount: retryCount + 1,
                    maxRetries: finalMaxRetries,
                })
            }

            this.log("error", "Max retries reached or unrecoverable error", { error })

            throw error
        }
    }
}
