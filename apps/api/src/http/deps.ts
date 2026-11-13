import type { AuthPort, Clock, Mailer, ObjectStorePort, Repository, NotifyPort } from '@ari/domain';
import type { Config } from '../config.js';
import type { Contract } from './openapi.js';

export interface Deps {
  config: Config; contract: Contract; repo: Repository; auth: AuthPort; store: ObjectStorePort; mailer: Mailer; clock: Clock; notify: NotifyPort;
}
