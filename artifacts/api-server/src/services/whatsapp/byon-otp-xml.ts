/**
 * VoiceXML for the BYON Meta/VoBiz OTP capture call.
 *
 * Vobiz Record posts to `action` with RecordUrl (see vobiz-voice-xml skill).
 * Plivo-style callbackUrl + transcriptionUrl are ignored — that left listening
 * mode armed, the call unanswered in Call History (Record hijacks the agent),
 * and no OTP on the page.
 */
export function buildByonOtpRecordXml(actionUrl: string): string {
  const action = actionUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return (
    `<Response>` +
    `<Record action="${action}" method="POST" maxLength="55" timeout="12" playBeep="false" fileFormat="mp3"/>` +
    `<Hangup/>` +
    `</Response>`
  );
}

export function buildByonOtpHangupXml(): string {
  return "<Response><Hangup/></Response>";
}
