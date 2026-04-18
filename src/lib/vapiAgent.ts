import { AGENT_SYSTEM_PROMPT, AGENT_FIRST_MESSAGE } from "./voiceAgentPrompt";

/**
 * Vapi assistant configuration.
 *
 * Vapi is a managed voice-AI platform: they run the STT, LLM, TTS,
 * and turn-taking inside their infrastructure and call our server
 * back for tool calls + end-of-call reports. This file builds the
 * JSON config that describes our assistant — you can either paste it
 * into the Vapi dashboard, or fetch it live from /api/vapi/config and
 * POST it to Vapi's REST API to create/update the assistant.
 *
 * Why Vapi over our own TwiML loop (src/lib/voiceAgent.ts):
 * - Sub-second response latency with streaming.
 * - Native barge-in (caller can interrupt).
 * - ElevenLabs / Cartesia voices, not Amazon Polly.
 * - Managed VAD + endpointing — no more empty-speech fallbacks.
 *
 * Voice + model choices are tunable from the dashboard without a
 * deploy. The shape below is the recommended starting point.
 */

export const VAPI_TOOL_NAMES = {
  takeMessage: "take_message",
  endCall: "end_call",
} as const;

export type VapiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  server?: { url: string; secret?: string };
  async?: boolean;
};

export type VapiAssistantConfig = {
  name: string;
  firstMessage: string;
  firstMessageMode: "assistant-speaks-first" | "assistant-waits-for-user";
  model: {
    provider: "anthropic";
    model: string;
    temperature: number;
    maxTokens: number;
    messages: { role: "system"; content: string }[];
    tools: VapiTool[];
  };
  voice: {
    provider: string;
    voiceId: string;
    model?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  };
  transcriber: {
    provider: "deepgram";
    model: string;
    language: string;
    smartFormat: boolean;
    keywords?: string[];
  };
  // Lifecycle webhook for end-of-call reports, status updates, etc.
  serverUrl: string;
  serverUrlSecret?: string;
  // Conversational polish
  backgroundSound?: "office" | "off";
  responseDelaySeconds?: number;
  llmRequestDelaySeconds?: number;
  numWordsToInterruptAssistant?: number;
  silenceTimeoutSeconds?: number;
  maxDurationSeconds?: number;
  endCallPhrases?: string[];
  endCallFunctionEnabled?: boolean;
  recordingEnabled?: boolean;
  hipaaEnabled?: boolean;
  analysisPlan?: {
    summaryPrompt?: string;
    structuredDataSchema?: Record<string, unknown>;
  };
};

type BuildArgs = {
  /** Public origin of this Next app, e.g. https://app.truetestlabs.com — no trailing slash. */
  appBaseUrl: string;
  /** Optional — included as X-Vapi-Secret-like header on every webhook call. */
  webhookSecret?: string;
};

export function buildVapiAssistantConfig(args: BuildArgs): VapiAssistantConfig {
  const appBaseUrl = args.appBaseUrl.replace(/\/$/, "");

  const tools: VapiTool[] = [
    {
      type: "function",
      function: {
        name: VAPI_TOOL_NAMES.takeMessage,
        description:
          "Record everything gathered so staff can follow up. Call this once you have at least the caller's name and reason, and ideally a callback number. Can be called again to update fields.",
        parameters: {
          type: "object",
          properties: {
            callerName: { type: "string", description: "Full name as given" },
            callbackNumber: {
              type: "string",
              description:
                "Best number to reach them. If same as caller ID, pass the same string; if different, pass the new one.",
            },
            reason: {
              type: "string",
              description:
                "Short 1-2 sentence reason for the call in the caller's own words where possible.",
            },
            intent: {
              type: "string",
              enum: [
                "new_client",
                "status_inquiry",
                "appointment",
                "vendor",
                "legal",
                "partnership",
                "spam",
                "other",
              ],
            },
            segment: {
              type: "string",
              enum: ["family_law", "dot", "non_dot", "dna", "unknown"],
            },
            urgency: { type: "string", enum: ["low", "normal", "high"] },
            language: { type: "string", enum: ["en", "es", "other"] },
          },
          required: ["callerName", "reason", "intent", "urgency"],
        },
      },
      server: { url: `${appBaseUrl}/api/vapi/tool`, secret: args.webhookSecret },
    },
    {
      type: "function",
      function: {
        name: VAPI_TOOL_NAMES.endCall,
        description:
          "End the call. Use after you have said goodbye, or if the caller is spam / wrong number, or after two failed attempts to understand them.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: ["message_taken", "spam", "unintelligible", "caller_hung_up", "other"],
            },
          },
          required: ["reason"],
        },
      },
      server: { url: `${appBaseUrl}/api/vapi/tool`, secret: args.webhookSecret },
    },
  ];

  return {
    name: "TrueTest Receptionist",
    firstMessage: AGENT_FIRST_MESSAGE,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "anthropic",
      // If Vapi hasn't added Sonnet 4.6 yet, fall back to the latest
      // Sonnet they list in the dashboard. Haiku 4.5 is the fallback
      // if latency turns out to matter more than phrasing nuance.
      model: "claude-sonnet-4-6",
      temperature: 0.4,
      maxTokens: 250,
      messages: [{ role: "system", content: AGENT_SYSTEM_PROMPT }],
      tools,
    },
    voice: {
      // ElevenLabs "Sarah" is a warm, professional American female
      // voice that tests well for front-desk scenarios. Swap to
      // "Rachel" or "Charlotte" from the Vapi dashboard if Sarah
      // doesn't feel right after a few test calls. Cartesia Sonic is
      // a lower-latency alternative worth A/B-ing.
      provider: "11labs",
      voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah — override in dashboard if desired
      model: "eleven_turbo_v2_5",
      stability: 0.5,
      similarityBoost: 0.8,
      style: 0.2,
      useSpeakerBoost: true,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "multi", // auto-detects English + Spanish in the same call
      smartFormat: true,
      // Seed the STT with our brand + common terms so it doesn't
      // write "TrueTax" or "MRO" as "ammo".
      keywords: [
        "TrueTest:5",
        "TrueTest Labs:5",
        "MRO:4",
        "DOT:3",
        "chain of custody:3",
        "Elk Grove Village:3",
        "Colleen:3",
        "Matt Gammel:3",
      ],
    },
    serverUrl: `${appBaseUrl}/api/vapi/events`,
    serverUrlSecret: args.webhookSecret,

    // ---- Conversational polish ----
    backgroundSound: "off",
    responseDelaySeconds: 0.4, // small pause before speaking — feels more human than instant
    llmRequestDelaySeconds: 0.1,
    numWordsToInterruptAssistant: 2, // caller needs ~2 words before we yield
    silenceTimeoutSeconds: 20, // hang up after this much silence
    maxDurationSeconds: 600, // belt + suspenders on runaway calls
    endCallPhrases: ["goodbye", "bye now", "have a good day"],
    endCallFunctionEnabled: true,
    recordingEnabled: true,
    hipaaEnabled: true, // Vapi strips transcripts from their retention when this is on

    analysisPlan: {
      summaryPrompt:
        "Summarize this call in 1-3 sentences for TrueTest Labs staff. Lead with who called and why. Mention anything time-sensitive. Plain prose, no bullets, no preamble.",
      structuredDataSchema: {
        type: "object",
        properties: {
          callerName: { type: "string" },
          callbackNumber: { type: "string" },
          intent: {
            type: "string",
            enum: [
              "new_client",
              "status_inquiry",
              "appointment",
              "vendor",
              "legal",
              "partnership",
              "spam",
              "other",
            ],
          },
          segment: {
            type: "string",
            enum: ["family_law", "dot", "non_dot", "dna", "unknown"],
          },
          urgency: { type: "string", enum: ["low", "normal", "high"] },
          language: { type: "string", enum: ["en", "es", "other"] },
          reason: { type: "string" },
        },
      },
    },
  };
}
