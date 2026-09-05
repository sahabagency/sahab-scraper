function topIssues(audit) {
  const severity = { high: 3, medium: 2, low: 1 };
  return (audit.issues || [])
    .slice()
    .sort((a, b) => (severity[b.severity] || 0) - (severity[a.severity] || 0))
    .slice(0, 3)
    .map(issue => issue.title.replace('Missing or weak: ', ''));
}

function fallbackMessage({ lead, audit, bookingUrl }) {
  const issues = topIssues(audit);
  const range = audit.opportunity?.annualRange;
  const opportunity = range
    ? `Based on a conservative model, the visible gaps may represent roughly ${range.low.toLocaleString()}–${range.high.toLocaleString()} in annual opportunity under the assumptions used.`
    : '';

  return {
    subject: `Quick growth audit for ${lead.name}`,
    body: `Hi ${lead.name} team,\n\nI reviewed your public digital presence and found a few conversion gaps worth fixing: ${issues.join(', ') || 'a few measurable funnel issues'}.\n\n${opportunity}\n\nI’m not sending a generic sales pitch — I can walk you through the exact findings and what I’d fix first in a short call.\n\n${bookingUrl ? `Book a time here: ${bookingUrl}\n\n` : ''}Best,\nSahab Agency`,
    channel: 'email'
  };
}

async function viaOpenAI({ lead, audit, bookingUrl, industry, location }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const payload = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content: 'You write concise B2B outbound email. Be factual, specific, calm, and non-spammy. Never claim verified revenue loss unless the evidence proves it. If using an estimate, clearly label it as an estimate based on assumptions. Output JSON with subject and body only.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          business: lead.name,
          website: lead.website,
          industry,
          location,
          auditScore: audit.score,
          issues: topIssues(audit),
          opportunityEstimate: audit.opportunity,
          bookingUrl
        })
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) return null;
  const data = await response.json();
  const text = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
  if (!text) return null;

  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.subject || !parsed.body) return null;
    return { subject: parsed.subject, body: parsed.body, channel: 'email', generatedBy: 'openai' };
  } catch {
    return null;
  }
}

export async function buildOutreach(args) {
  return (await viaOpenAI(args).catch(() => null)) || fallbackMessage(args);
}
