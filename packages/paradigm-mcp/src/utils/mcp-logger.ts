import { ParadigmLogger } from '@a-company/paradigm-logger';

export const log = new ParadigmLogger({
  output: (line) => process.stderr.write(line + '\n'),
});
