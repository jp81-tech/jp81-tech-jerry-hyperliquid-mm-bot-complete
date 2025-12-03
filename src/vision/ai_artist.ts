import OpenAI from 'openai';
import { ChartRenderer } from './chart_renderer.js';

export type VisualPattern =
  | "bull_flag" | "bear_flag" | "double_top" | "double_bottom"
  | "triangle" | "wedge" | "range" | "parabolic" | "head_and_shoulders" | "none";

export type VisualAnalysis = {
  visualTrend: "up" | "down" | "sideways";
  pattern: VisualPattern;
  patternConfidence: number; // 0-1
  exhaustion: boolean;
  squeezeRisk: boolean;
  breakoutRisk: boolean;
  visualScore: number; // 0-100 (0=Bearish, 100=Bullish)
  riskScore: number;   // 0-10 (0=Safe, 10=Extreme Risk)
  comment: string;
};

export class AIArtist {
    private openai: OpenAI | null = null;

    constructor() {
        const enabled = process.env.AI_VISION_ENABLED !== 'false'; // Default to true if not explicitly disabled
        const apiKey = process.env.OPENAI_API_KEY;

        if (!enabled || !apiKey) {
            console.log(
                `🎨 [AI VISION] disabled (enabled=${enabled}, apiKey=${apiKey ? 'SET' : 'MISSING'})`
            );
            this.openai = null;
            return;
        }

        this.openai = new OpenAI({ apiKey });
        console.log('🎨 [AI VISION] enabled (GPT-4o)');
    }

    isEnabled(): boolean {
        return this.openai !== null;
    }

    async analyzeChart(candles: any[]): Promise<VisualAnalysis> {
        if (!this.openai || candles.length < 10) {
            return this.getDefaultAnalysis();
        }

        try {
            // 1. Render Chart (In-Memory Buffer, no disk IO)
            const imageBuffer = ChartRenderer.renderCandles(candles);
            const base64Image = imageBuffer.toString('base64');

            // Debug: Log image data if requested
            if (process.env.AI_VISION_DEBUG_IMAGE === 'true') {
                console.log(
                    `🖼️ [AI_VISION_IMG] data:image/png;base64,${base64Image.slice(0, 200)}...`
                );
            }

            // 2. Ask GPT-4o
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are an elite crypto market maker and technical analyst.
                        Analyze the chart image provided (OHLC candles + EMA20/50 + VWAP + Volume). Look for Price Action, Patterns, and Risks.

                        Return JSON format:
                        {
                            "visualTrend": "up"|"down"|"sideways",
                            "pattern": "bull_flag"|"bear_flag"|"double_top"|"double_bottom"|"triangle"|"wedge"|"range"|"parabolic"|"none",
                            "patternConfidence": number 0.0-1.0,
                            "exhaustion": boolean (is the move overextended?),
                            "squeezeRisk": boolean (is volatility compressing for a big move?),
                            "breakoutRisk": boolean (is price banging against a level expecting breakout?),
                            "visualScore": number 0-100 (0=Super Bearish, 50=Neutral, 100=Super Bullish),
                            "riskScore": number 0-10 (0=Safe, 10=Extreme Risk/Parabolic/FlashCrash),
                            "comment": "short tactical insight (<10 words)"
                        }`
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this crypto chart." },
                            {
                                type: "image_url",
                                image_url: {
                                    "url": `data:image/png;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 300,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0].message.content;
            if (!content) throw new Error("No content from OpenAI");

            const visual = JSON.parse(content) as VisualAnalysis;

            console.log(
                `🎨 [AI VISION] trend=${visual.visualTrend} pattern=${visual.pattern} ` +
                `score=${visual.visualScore} risk=${visual.riskScore} ` +
                `exhaustion=${visual.exhaustion} squeeze=${visual.squeezeRisk} breakout=${visual.breakoutRisk}`
            );

            return visual;

        } catch (error) {
            console.error('[AI_VISION] Analysis failed:', error);
            return this.getDefaultAnalysis();
        }
    }

    private getDefaultAnalysis(): VisualAnalysis {
        return {
            visualTrend: 'sideways',
            pattern: 'none',
            patternConfidence: 0,
            exhaustion: false,
            squeezeRisk: false,
            breakoutRisk: false,
            visualScore: 50,
            riskScore: 0,
            comment: 'Analysis unavailable'
        };
    }
}
