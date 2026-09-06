const UNSUPPORTED_ABSOLUTE_PATTERNS = [
  /أنت(?:م|كم)?\s+تخسر(?:ون)?\s+\d/iu,
  /خسارت(?:كم|ك)\s+(?:هي|تبلغ|تصل)\s+\d/iu,
  /you\s+(?:are\s+)?losing\s+\$?\d/iu,
  /verified\s+loss/iu
];

const QUALIFIER_PATTERNS = [
  /تقدير/iu,
  /تقديري/iu,
  /قد\s+تكون/iu,
  /فرصة\s+ضائعة/iu,
  /estimated/iu,
  /assumption/iu,
  /ليست\s+خسارة\s+محققة/iu
];

function containsQualifier(text = '') {
  return QUALIFIER_PATTERNS.some(re => re.test(text));
}

export function validateOutreach({ subject = '', body = '', bookingUrl = '', audit = {} } = {}) {
  const errors = [];
  const warnings = [];
  const full = `${subject}\n${body}`;

  if (!subject.trim()) errors.push('missing_subject');
  if (!body.trim()) errors.push('missing_body');
  if (subject.length > 110) errors.push('subject_too_long');
  if (body.length > 2200) warnings.push('body_long');
  if (body.length < 180) warnings.push('body_too_short');

  if (bookingUrl) {
    const occurrences = body.split(bookingUrl).length - 1;
    if (occurrences !== 1) errors.push(occurrences === 0 ? 'missing_booking_url' : 'booking_url_repeated');
  }

  const hasAbsoluteClaim = UNSUPPORTED_ABSOLUTE_PATTERNS.some(re => re.test(full));
  if (hasAbsoluteClaim && !containsQualifier(full)) errors.push('unqualified_loss_claim');

  if (audit?.opportunity?.annualRange?.high > 0 && !containsQualifier(full)) {
    errors.push('estimate_qualifier_missing');
  }

  if (/guarantee|مضمون|نضمن|أكيد\s+بتحقق|سنحقق\s+لك/iu.test(full)) errors.push('guaranteed_outcome_claim');
  if (/ترتيبك\s+في\s+جوجل|ميزانية\s+إعلاناتك|زيارات\s+موقعك/iu.test(full) && !audit?.evidence?.verifiedCommercialMetric) {
    warnings.push('possibly_unsupported_metric_claim');
  }

  if (/!!!|🔥|🚀|💰|💸/.test(subject)) warnings.push('spammy_subject_signal');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: { subjectLength: subject.length, bodyLength: body.length }
  };
}
