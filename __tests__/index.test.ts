import { Lsof } from "../src/index"
import { z } from "zod"

describe("Lsof", () => {
    let lsof: Lsof

    beforeEach(() => {
        lsof = new Lsof({})
    })

    it("should generate valid JSON", async () => {
        const schema = z.object({
            message: z.string(),
            count: z.number(),
        })

        const mockResponse = JSON.stringify({
            message: "Hello World",
            count: 42
        })

        const llmAdapter = jest.fn().mockResolvedValue(mockResponse)

        const result = await lsof.generateJson({
            llmAdapter,
            schema,
            prompt: "Generate a greeting",
        })

        expect(result.data).toEqual({
            message: "Hello World",
            count: 42
        })
        expect(result.metadata.wasRepaired).toBe(false)
        expect(llmAdapter).toHaveBeenCalled()

        const callArg = llmAdapter.mock.calls[0][0]
        expect(callArg).toContain("Instruction:\nGenerate a greeting")
    })

    it("should repair invalid JSON", async () => {
        const schema = z.object({
            value: z.number(),
        })

        const invalidJson = "{ value: 10, }"

        const llmAdapter = jest.fn().mockResolvedValue(invalidJson)

        const result = await lsof.generateJson({
            llmAdapter,
            schema,
            prompt: "Generate value",
        })

        expect(result.data).toEqual({ value: 10 })
        expect(result.metadata.retryCount).toBe(0)
        expect(result.metadata.wasRepaired).toBe(true)
    })

    it("should retry on schema validation error", async () => {
        const schema = z.object({
            status: z.literal("OK"),
        })

        const response1 = JSON.stringify({ status: "ERROR" })
        const response2 = JSON.stringify({ status: "OK" })

        const llmAdapter = jest.fn()
            .mockResolvedValueOnce(response1)
            .mockResolvedValueOnce(response2)

        const result = await lsof.generateJson({
            llmAdapter,
            schema,
            prompt: "Get status",
            maxRetries: 2
        })

        expect(result.data).toEqual({ status: "OK" })
        expect(result.metadata.retryCount).toBe(1)
        expect(llmAdapter).toHaveBeenCalledTimes(2)

        const secondCallPrompt = llmAdapter.mock.calls[1][0]
        expect(secondCallPrompt).toContain("Error details:")
    })

    it("should throw after max retries", async () => {
        const schema = z.object({
            id: z.number(),
        })

        const badResponse = JSON.stringify({ id: "string" })
        const llmAdapter = jest.fn().mockResolvedValue(badResponse)

        await expect(lsof.generateJson({
            llmAdapter,
            schema,
            prompt: "Get ID",
            maxRetries: 2
        })).rejects.toThrow()


        expect(llmAdapter).toHaveBeenCalledTimes(3)
    })
})
