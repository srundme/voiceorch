import { CodeBlock } from "../CodeBlock";

export default function PromptingGuidePage() {
  return (
    <div>
      <h1>Prompting Guide</h1>
      <p>
        A voice agent's system prompt is fundamentally different from a chatbot's. Callers cannot
        read, they can't go back and re-read what was said, and long pauses feel rude. This guide
        covers how to write prompts that produce natural, effective phone conversations.
      </p>

      <h2 id="voice-vs-text">Voice vs. text prompting</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Aspect</th>
              <th className="px-4 py-3 font-semibold">Text / Chat agents</th>
              <th className="px-4 py-3 font-semibold">Voice agents</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Response length", "As long as needed — user can scroll", "Short — 1–2 sentences per turn"],
              ["Formatting", "Markdown, bullet points, tables", "Plain prose only — no symbols"],
              ["Pacing", "User reads at their own speed", "Agent controls speed via speech"],
              ["Ambiguity", "User can re-read to clarify", "Must ask clarifying questions immediately"],
              ["Memory", "User sees the full thread", "Caller only hears what was said aloud"],
              ["Interruption", "Not applicable", "Callers can barge in at any time"],
            ].map(([a, t, v]) => (
              <tr key={a} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{a}</td>
                <td className="px-4 py-3 text-muted-foreground">{t}</td>
                <td className="px-4 py-3 text-muted-foreground">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="core-rules">Core rules</h2>

      <h3 id="short-responses">1. Keep responses short</h3>
      <p>
        The single most important rule. Explicitly tell the model to be brief, because LLMs trained
        on text naturally favour completeness over conciseness.
      </p>
      <CodeBlock language="text" code={`# Good
"Respond in 1–2 sentences maximum. This is a phone call."

# Better
"After every response, count the words. If over 30, rewrite it shorter."`} />

      <h3 id="no-markdown">2. No markdown or lists</h3>
      <p>
        Bullet points, asterisks, and headers are read literally by TTS, producing unnatural
        speech. Ban them explicitly.
      </p>
      <CodeBlock language="text" code={`# Good rule in your prompt
"Never use bullet points, numbered lists, markdown, asterisks, or parenthetical notes.
Speak in natural conversational sentences only."`} />

      <h3 id="persona">3. Define a clear persona</h3>
      <p>
        Give the agent a name, a company, and a specific role. Vague instructions produce inconsistent
        tone. Specific personas are much easier to prompt-engineer.
      </p>
      <CodeBlock language="text" code={`# Too vague
"You are a helpful assistant."

# Good
"You are Arjun, a senior sales consultant at SnapServe.
Your job is to understand the prospect's use case and qualify them for a demo.
You are warm, professional, and concise. You never hard-sell."`} />

      <h3 id="objective">4. State the objective explicitly</h3>
      <p>
        The LLM needs to know what "success" looks like for this call. Without a clear objective it
        will try to be generally helpful instead of driving toward a specific outcome.
      </p>
      <CodeBlock language="text" code={`"Your objective is to:
1. Confirm the prospect's name and company.
2. Ask what use case they want to automate with voice AI.
3. Book a 30-minute demo using the book_appointment tool.
4. Thank them and end the call politely.

If they are not interested, thank them and end the call — do not push."`} />

      <h3 id="handling-unknowns">5. Define how to handle unknowns</h3>
      <p>
        What should the agent do when it doesn't know the answer? Without guidance, LLMs hallucinate.
        Give explicit fallback instructions.
      </p>
      <CodeBlock language="text" code={`"If you do not know the answer to a question, say:
'I don't have that information right now. Let me have someone from our team call you back.'
Then ask for their preferred callback time and use the send_webhook tool to create a callback request.
Never make up facts about pricing, features, or availability."`} />

      <h3 id="ending-calls">6. Specify how to end calls</h3>
      <p>
        Without explicit instructions, agents tend to keep the conversation going. Define the
        conditions under which the agent should conclude the call.
      </p>
      <CodeBlock language="text" code={`"End the call when:
- The appointment is booked and confirmed.
- The caller says goodbye, thanks, or indicates they want to hang up.
- You have attempted to help and the caller does not need anything else.

To end the call, always use the end_call tool — never just stop responding."`} />

      <h2 id="full-example">Full example prompt</h2>
      <CodeBlock language="text" code={`You are Priya, a customer success agent at SnapServe.
Your goal is to help new users get their first voice agent live.

Guidelines:
- Respond in 1–2 sentences maximum. This is a phone call.
- Speak naturally. No bullet points, no markdown, no lists.
- Always address the caller by their first name after they give it.
- If you don't know something, say "Let me have our team follow up on that."
- End the call once the user's question is resolved.

The user's name is {{lead_name}}.
They signed up {{signup_date}} ago and have not yet created an agent.

Start by greeting them by name and asking what's holding them back from setting up their first agent.`} />

      <h2 id="prompting-for-tools">Prompting for tools</h2>
      <p>
        When tools are enabled, the LLM must know when and how to use them. Include a tool usage
        section in your prompt:
      </p>
      <CodeBlock language="text" code={`Available tools and when to use them:

- book_appointment: Call this when the caller agrees to a specific date and time.
  Always confirm the date and time aloud before calling the tool.
  After booking, confirm the booking ID and their email aloud.

- check_availability: Call this when the caller asks what times are available.
  Do not ask for their preference before checking — check first, then present 2–3 options.

- end_call: Always call this when saying goodbye. Never just stop responding.

- transfer_call: Only use this if the caller explicitly asks to speak to a human agent.
  Always ask: "Would you like me to transfer you to a live agent?" before transferring.`} />

      <h2 id="multilingual">Multilingual agents</h2>
      <p>
        For agents that handle multiple languages, instruct the agent to detect and match the
        caller's language:
      </p>
      <CodeBlock language="text" code={`"Respond in the same language the caller uses.
If the caller speaks Hindi, respond in Hindi.
If the caller switches languages mid-call, switch with them.
Always greet in English first unless you know the caller's language in advance."`} />
      <p>
        Make sure your ASR provider supports the expected languages (Deepgram Nova-3 supports 30+
        languages; Azure has the widest coverage). Your TTS provider must have voices in the target
        language — ElevenLabs and Azure both have strong multilingual support.
      </p>

      <h2 id="testing-prompts">Testing your prompt</h2>
      <ul>
        <li>Use <strong>WebCall</strong> to test the agent directly in the browser before connecting a phone number.</li>
        <li>Check the <strong>Calls Log</strong> transcript after each test — look for places where the agent gave long responses or used formatting.</li>
        <li>Simulate edge cases: the caller doesn't know what they want, the caller is rude, the caller asks out-of-scope questions.</li>
        <li>Lower the LLM temperature (0.2–0.4) for factual support bots where consistency matters more than variety.</li>
      </ul>
    </div>
  );
}
