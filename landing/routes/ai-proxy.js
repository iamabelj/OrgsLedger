// ============================================================
// AI Proxy Routes — Transcription & Summarization
// Clients call these endpoints; gateway proxies to Google/OpenAI
// ============================================================

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const upload = multer({
  dest: path.join(__dirname, '..', 'temp-uploads'),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// Pricing estimates (USD)
const PRICING = {
  'speech-to-text': 0.006,  // per 15 seconds ($0.024/min)
  'openai-gpt4o': 0.005,    // per 1K tokens (input)
  'openai-gpt4o-out': 0.015, // per 1K tokens (output)
};

module.exports = function (pool) {
  const router = express.Router();

  // ── POST /api/ai/transcribe ───────────────────────────
  // Accepts audio file or GCS URI, returns transcript
  router.post('/transcribe', upload.single('audio'), async (req, res) => {
    const startTime = Date.now();
    let audioSeconds = 0;
    let status = 'success';
    let errorMessage = null;

    try {
      const { audio_uri, encoding, sample_rate, language } = req.body;

      // Google Speech-to-Text
      const speech = require('@google-cloud/speech');
      const client = new speech.SpeechClient();

      let request;

      if (req.file) {
        // File upload — read and send as content
        const audioContent = fs.readFileSync(req.file.path).toString('base64');
        request = {
          config: {
            encoding: encoding || 'LINEAR16',
            sampleRateHertz: parseInt(sample_rate) || 16000,
            languageCode: language || 'en-US',
            enableAutomaticPunctuation: true,
            enableSpeakerDiarization: true,
            diarizationSpeakerCount: 10,
            model: 'latest_long',
          },
          audio: { content: audioContent },
        };
      } else if (audio_uri) {
        // GCS URI
        request = {
          config: {
            encoding: encoding || 'LINEAR16',
            sampleRateHertz: parseInt(sample_rate) || 16000,
            languageCode: language || 'en-US',
            enableAutomaticPunctuation: true,
            enableSpeakerDiarization: true,
            diarizationSpeakerCount: 10,
            model: 'latest_long',
          },
          audio: { uri: audio_uri },
        };
      } else {
        return res.status(400).json({ error: 'Audio file or audio_uri required' });
      }

      const [operation] = await client.longRunningRecognize(request);
      const [response] = await operation.promise();

      const segments = [];
      let currentTime = 0;

      if (response.results) {
        for (const result of response.results) {
          const alt = result.alternatives?.[0];
          if (alt?.transcript) {
            const words = alt.words || [];
            const startSec = words[0]?.startTime
              ? Number(words[0].startTime.seconds || 0)
              : currentTime;
            const endSec = words[words.length - 1]?.endTime
              ? Number(words[words.length - 1].endTime.seconds || 0)
              : startSec + 5;
            const speakerTag = words[0]?.speakerTag || 0;

            segments.push({
              speakerName: `Speaker ${speakerTag}`,
              text: alt.transcript,
              startTime: startSec,
              endTime: endSec,
              language: result.languageCode || language || 'en-US',
            });

            currentTime = endSec;
            audioSeconds = Math.max(audioSeconds, endSec);
          }
        }
      }

      // Estimate cost: $0.006 per 15 seconds
      const cost = (audioSeconds / 15) * PRICING['speech-to-text'];

      // Calculate hours to deduct (audio seconds -> hours)
      const hoursDeducted = audioSeconds / 3600;

      // Deduct hours from client balance
      await pool.query(
        'UPDATE ai_clients SET hours_used = hours_used + $1, updated_at = NOW() WHERE id = $2',
        [hoursDeducted, req.client.id]
      );

      // Log usage
      await pool.query(`
        INSERT INTO ai_usage_logs (client_id, service, endpoint, audio_seconds, hours_deducted, estimated_cost, status, ip_address, request_metadata)
        VALUES ($1, 'speech-to-text', '/transcribe', $2, $3, $4, 'success', $5, $6)
      `, [
        req.client.id,
        Math.ceil(audioSeconds),
        hoursDeducted.toFixed(4),
        cost.toFixed(6),
        req.ip,
        JSON.stringify({ language: language || 'en-US', encoding: encoding || 'LINEAR16' }),
      ]);

      res.json({
        success: true,
        transcript: segments,
        audioSeconds: Math.ceil(audioSeconds),
        estimatedCost: parseFloat(cost.toFixed(6)),
      });
    } catch (err) {
      status = 'error';
      errorMessage = err.message;
      console.error('Transcription error:', err.message);

      // Log failed attempt
      await pool.query(`
        INSERT INTO ai_usage_logs (client_id, service, endpoint, status, error_message, ip_address)
        VALUES ($1, 'speech-to-text', '/transcribe', 'error', $2, $3)
      `, [req.client.id, err.message, req.ip]).catch(() => {});

      res.status(500).json({ error: 'Transcription failed', message: err.message });
    } finally {
      // Cleanup temp file
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }
    }
  });

  // ── POST /api/ai/summarize ────────────────────────────
  // Accepts transcript text, returns structured minutes
  router.post('/summarize', async (req, res) => {
    let tokensUsed = 0;

    try {
      const { transcript, meeting_title, meeting_description, agenda } = req.body;

      if (!transcript) {
        return res.status(400).json({ error: 'transcript is required' });
      }

      const OpenAI = require('openai').default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const transcriptText = Array.isArray(transcript)
        ? transcript.map(s => `[${s.speakerName}] (${formatTime(s.startTime)}): ${s.text}`).join('\n')
        : transcript;

      const agendaText = Array.isArray(agenda)
        ? agenda.map((a, i) => `${i + 1}. ${a.title || a}`).join('\n')
        : (agenda || '');

      const prompt = `You are a professional meeting secretary. Analyze the following meeting transcript and generate structured meeting minutes.

Meeting: "${meeting_title || 'Untitled Meeting'}"
${meeting_description ? `Description: ${meeting_description}` : ''}
${agendaText ? `\nAgenda:\n${agendaText}` : ''}

Transcript:
${transcriptText}

Generate the following in JSON format:
{
  "summary": "A concise executive summary of the meeting (2-4 paragraphs)",
  "decisions": ["List of decisions made during the meeting"],
  "motions": [{"text": "Motion text", "movedBy": "Speaker name", "secondedBy": "Speaker name", "result": "passed|failed|tabled"}],
  "actionItems": [{"description": "Action item", "assigneeName": "Person responsible", "dueDate": "YYYY-MM-DD or null", "priority": "critical|high|medium|low", "status": "pending"}],
  "contributions": [{"userName": "Speaker name", "speakingTimeSeconds": 120, "keyPoints": ["Key point 1", "Key point 2"]}]
}

For action items:
- Priority levels: Use "critical" for items blocking other work or time-sensitive, "high" for important but not blocking, "medium" for nice-to-have, "low" for minor items
- Due dates: Extract from meeting context (e.g., "by EOW", "next week", explicit dates). Use YYYY-MM-DD format or null if not specified.

Be thorough and accurate.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI');

      const parsed = JSON.parse(content);
      tokensUsed = (response.usage?.total_tokens) || 0;
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;

      // Estimate cost
      const cost =
        (inputTokens / 1000) * PRICING['openai-gpt4o'] +
        (outputTokens / 1000) * PRICING['openai-gpt4o-out'];

      // Calculate hours to deduct (tokens -> hours: ~100K tokens = 1 hour)
      const hoursDeducted = tokensUsed / 100000;

      // Deduct hours from client balance
      await pool.query(
        'UPDATE ai_clients SET hours_used = hours_used + $1, updated_at = NOW() WHERE id = $2',
        [hoursDeducted, req.client.id]
      );

      // Log usage
      await pool.query(`
        INSERT INTO ai_usage_logs (client_id, service, endpoint, tokens_used, hours_deducted, estimated_cost, status, ip_address, request_metadata)
        VALUES ($1, 'openai', '/summarize', $2, $3, $4, 'success', $5, $6)
      `, [
        req.client.id,
        tokensUsed,        hoursDeducted.toFixed(4),        cost.toFixed(6),
        req.ip,
        JSON.stringify({ model: 'gpt-4o', inputTokens, outputTokens }),
      ]);

      res.json({
        success: true,
        minutes: parsed,
        tokensUsed,
        estimatedCost: parseFloat(cost.toFixed(6)),
      });
    } catch (err) {
      console.error('Summarization error:', err.message);

      await pool.query(`
        INSERT INTO ai_usage_logs (client_id, service, endpoint, tokens_used, status, error_message, ip_address)
        VALUES ($1, 'openai', '/summarize', $2, 'error', $3, $4)
      `, [req.client.id, tokensUsed, err.message, req.ip]).catch(() => {});

      res.status(500).json({ error: 'Summarization failed', message: err.message });
    }
  });

  // ── GET /api/ai/usage ─────────────────────────────────
  // Client can check their own usage
  router.get('/usage', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          COALESCE(SUM(audio_seconds), 0) as total_audio_seconds,
          COALESCE(SUM(tokens_used), 0) as total_tokens,
          COALESCE(SUM(estimated_cost), 0) as total_cost,
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE status = 'success') as successful_requests,
          COUNT(*) FILTER (WHERE status = 'error') as failed_requests
        FROM ai_usage_logs
        WHERE client_id = $1 
          AND created_at >= date_trunc('month', NOW())
      `, [req.client.id]);

      const usage = result.rows[0];

      res.json({
        success: true,
        period: 'current_month',
        usage: {
          hoursBalance: parseFloat(req.client.hours_balance || 0),
          hoursUsed: parseFloat(req.client.hours_used || 0),
          hoursRemaining: parseFloat(req.client.hours_balance || 0) - parseFloat(req.client.hours_used || 0),
          audioMinutes: Math.ceil(parseInt(usage.total_audio_seconds) / 60),
          tokensUsed: parseInt(usage.total_tokens),
          estimatedCost: parseFloat(parseFloat(usage.total_cost).toFixed(4)),
          totalRequests: parseInt(usage.total_requests),
          successfulRequests: parseInt(usage.successful_requests),
          failedRequests: parseInt(usage.failed_requests),
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch usage' });
    }
  });

  return router;
};

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
