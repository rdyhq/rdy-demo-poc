// A log line names the kind of failure and where it started.
// The message can hold personal data, so it stays out of the log.
export function describeFailure(error:unknown) {
  if(!(error instanceof Error)) return error===null?'null':typeof error;
  const code=(error as {code?:unknown}).code;
  const place=error.stack?.split('\n').find(line=>line.trimStart().startsWith('at '))?.trim()??'at an unknown place';
  return error.name+(typeof code==='string'?' '+code:'')+' '+place;
}
