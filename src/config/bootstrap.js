import { STORAGE_KEYS } from './constants.js';
import { suchKonfigurationenDefault } from './defaults/ausstattung.js';
import { techDataKonfigurationenDefault } from './defaults/tech.js';
import { mergeGruppenConfigDefault } from './defaults/merge-groups.js';
import { ladeFeatureFlags } from './feature-flags/index.js';
import {
    dedupeAmbiguousBegriffeAcrossConfigs,
    migrateAusstattungPreisGewicht,
    migrateIfNeeded
} from './migration/index.js';
import { ladeConfig } from './persistence.js';
import { runtimeState } from './runtime-state.js';

export function bootstrapConfig() {
    migrateIfNeeded();
    runtimeState.suchKonfigurationen = migrateAusstattungPreisGewicht(
        dedupeAmbiguousBegriffeAcrossConfigs(
            ladeConfig(STORAGE_KEYS.config) || suchKonfigurationenDefault
        )
    );
    runtimeState.techDataKonfigurationen =
        ladeConfig(STORAGE_KEYS.techConfig) || techDataKonfigurationenDefault;
    runtimeState.mergeGruppenConfig =
        ladeConfig(STORAGE_KEYS.mergeGroups) || mergeGruppenConfigDefault;
    runtimeState.featureFlags = ladeFeatureFlags();
    runtimeState.pendingAusstattungPrefill = null;
}
