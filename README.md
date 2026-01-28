# @marcuth/lsof

**@marcuth/lsof** (LLM Structured Output Forcer) is a robust layer designed to enforce structured JSON output from Large Language Models (LLMs) that may not natively support schemas. It mimics the behavior of "Ai Studio" or "Gemini" structured output but works with **any** LLM provider.

It uses **Zod** for schema definition and validation, and includes a powerful auto-repair mechanism to fix broken JSON and a retry system that feeds validation errors back to the model for correction.

## 📦 Installation

Installation is straightforward simply use your preferred package manager. Here is an example using NPM:

```bash
npm i @marcuth/lsof zod
```

> **Note:** This package requires `zod` as a peer dependency.

## 🚀 Usage

<a href="https://www.buymeacoffee.com/marcuth">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="200">
</a>

### Basic Example

Here is how to use `Lsof` to guarantee a specific JSON structure from your LLM calls.

```ts
import { Lsof } from "@marcuth/lsof"
import { z } from "zod"

(async () => {
    // 1. Initialize Lsof instance
    const lsof = new Lsof({
        defaultMaxRetries: 3 // Default attempts to get valid JSON
    })

    // 2. Define the schema you want the LLM to follow
    const schema = z.object({
        sentiment: z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL"]),
        confidence: z.number().min(0).max(1),
        analysis: z.string()
    })

    // 3. Create an adapter for your LLM of choice
    // This function just needs to take a string prompt and return a string response
    const myLlmAdapter = async (prompt: string) => {
        // Example: call OpenAI, Anthropic, or a local model here
        // const response = await openai.chat.completions.create({...})
        // return response.choices[0].message.content
        return `{"sentiment": "POSITIVE", "confidence": 0.98, "analysis": "Great vibe!"}`
    }

    // 4. Generate the structured data
    try {
        const result = await lsof.generateJson({
            llmAdapter: myLlmAdapter,
            schema: schema,
            prompt: "Analyze the sentiment of this text: 'I absolutely love using this library!'"
        })

        console.log(result.data) 
        // Output: { sentiment: "POSITIVE", confidence: 0.98, analysis: "Great vibe!" }
        
        console.log(result.metadata)
        // Output: { retryCount: 0, wasRepaired: false }

    } catch (error) {
        console.error("Failed to generate valid JSON after retries", error)
    }
})()
```

---

### Features

#### 🛡️ Schema Enforcement

Define strictly typed schemas using Zod. `Lsof` injects the JSON schema directly into the prompt so the model knows exactly what to generate.

#### 🔧 Auto-Repair

If the LLM returns slightly broken JSON (e.g., missing quotes, trailing commas), `Lsof` attempts to repair it automatically using `jsonrepair` before giving up.

#### 🔁 Intelligent Retries

If the JSON is valid but doesn't match the Zod schema (e.g., a number was expected but a string was returned), `Lsof` sends the validation error back to the LLM in a new prompt, asking it to correct its mistake.

---

### Advanced Configuration

#### Customizing Prompts

You can customize the instructions sent to the LLM, including the prompt prefix for repairs.

```ts
const lsof = new Lsof({
    defaultMaxRetries: 5,
    repairPrompt: {
        prefix: "Warning: You generated invalid data. Fix it immediately based on this error:",
        fn: (prefix, error) => `${prefix} \n >> ${error}`
    }
})
```

---

## 🧪 Testing

Automated tests are located in the `tests` directory. To run them:

```bash
npm run tests
```

## 🤝 Contributing

Want to contribute? Follow these steps:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature-new`).
3. Commit your changes (`git commit -m 'Add new feature'`).
4. Push to the branch (`git push origin feature-new`).
5. Open a Pull Request.

## 📝 License

This project is licensed under the MIT License.
