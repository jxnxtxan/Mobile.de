#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
mono_path = ROOT / 'src/legacy/monolith.js'
lines = mono_path.read_text(encoding='utf-8').splitlines()


def find_line(pattern, start=0):
    for i in range(start, len(lines)):
        if pattern in lines[i]:
            return i
    raise ValueError(pattern)


def extract(start, end):
    out = []
    for line in lines[start:end]:
        if line.startswith('    '):
            out.append(line[4:])
        elif line.strip() == '':
            out.append('')
        else:
            out.append(line)
    return out


def export_functions(body_lines):
    return [
        ('export ' + line if re.match(r'^(function |const )', line) else line)
        for line in body_lines
    ]


def write_file(path, header, body_lines):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(header + '\n'.join(export_functions(body_lines)) + '\n', encoding='utf-8')


# Markers
ordering_s = find_line('function isAutoModeEnabled()')
ordering_e = find_line('// 5) Match-Engine')
match_s = find_line('const MAX_WORD_GAP')
match_e = find_line('// 6) Quellen-Extraktion')
sel_s = find_line('function getFeatureItems()')
src_s = find_line('function classifyDescription(rawText)')
src_e = find_line('// 6b) Automodus')
auto_s = find_line('function isPlausibleEquipmentLabel')
merge_s = find_line('function entryMatchesMergeGroup(entry, group)')
merge_e = find_line('function extractRawEquipmentItems()')
collect_raw_s = find_line('function collectRawConfigHits()')
get_result_s = find_line('function getResultEntries()')
open_learn_s = find_line('function openLearnConfig(label, source)')
open_learn_e = find_line('/**')
finalize_s = find_line('function finalizeAusstattungResults(entries)')
config_match_s = find_line('function begriffMatchScore(begriff)')
config_match_e = find_line('// 7) Begriffs-Suche')
suche_s = find_line('function sucheBegriffe()')
suche_e = find_line('function subsetDedup(entries)')
merge2_s = suche_e
merge2_e = find_line('// 7b) Ergebnis-UI')
styles_s = find_line('function injectResultStyles()')
styles_e = find_line('// 8) Suche nach Technischen Daten')
tech_s = find_line('function sucheTechnischeDaten()')
tech_e = find_line('// 9) Render:')
render_s = find_line('function appendResultRow(columns, item, autoMode)')
render_e = find_line('// 9b) Preisbewertung')

write_file(
    ROOT / 'src/config/ordering.js',
    """import { mergeListOrder } from './feature-flags/index.js';
import { getFavoriteAnzeigeKeys, partitionEntriesByFavorites } from './list-helpers.js';
import { runtimeState } from './runtime-state.js';

""",
    extract(ordering_s, ordering_e),
)

write_file(
    ROOT / 'src/core/match/engine.js',
    """import { escapeRegex, tokenize } from '../text/normalize.js';

""",
    extract(match_s, match_e),
)

write_file(ROOT / 'src/core/dom/selectors.js', '', extract(sel_s, src_s))

write_file(
    ROOT / 'src/core/dom/sources.js',
    """import { tokenize } from '../text/normalize.js';
import { getDescriptionEl, getFeatureItems, getTechDataDl, getZusatzEl } from './selectors.js';

""",
    extract(src_s, src_e),
)

write_file(
    ROOT / 'src/core/search/merge-groups.js',
    """import { cleanText } from '../text/normalize.js';
import { debugLog } from '../../config/feature-flags/index.js';
import { runtimeState } from '../../config/runtime-state.js';

""",
    extract(merge_s, merge_e) + extract(merge2_s, merge2_e),
)
mg_path = ROOT / 'src/core/search/merge-groups.js'
mg_path.write_text(
    mg_path.read_text(encoding='utf-8').replace(
        'mergeGruppenConfig.find', 'runtimeState.mergeGruppenConfig.find'
    ),
    encoding='utf-8',
)

write_file(
    ROOT / 'src/core/search/config-matches.js',
    """import { cleanText, tokenize } from '../text/normalize.js';
import { isManualScope } from '../../config/ordering.js';
import { getMaxWordGap, isForbiddenInWindow, matchInTokens } from '../match/engine.js';

""",
    extract(config_match_s, config_match_e),
)

write_file(
    ROOT / 'src/core/search/automode.js',
    """import { cleanText, tokenize } from '../text/normalize.js';
import { classifyDescription } from '../dom/sources.js';
import { getDescriptionEl, getFeatureItems } from '../dom/selectors.js';
import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { sortEntriesByConfigOrder } from '../../config/ordering.js';
import { runtimeState } from '../../config/runtime-state.js';
import { collectConfigMatches } from './config-matches.js';
import { extractSources } from '../dom/sources.js';
import {
    enrichAussenMergeFromRaw,
    generalizedMergeEntries,
    subsetDedup,
} from './merge-groups.js';

""",
    extract(auto_s, merge_s) + extract(merge_e, collect_raw_s),
)

pipeline_body = (
    extract(collect_raw_s, get_result_s)
    + extract(get_result_s, open_learn_s)
    + extract(open_learn_s, open_learn_e)
    + extract(finalize_s, config_match_s)
    + extract(suche_s, suche_e)
)
pipeline_body = [
    line.replace('oeffneKonfigPopup()', 'openConfigPopup()') for line in pipeline_body
]
write_file(
    ROOT / 'src/core/search/pipeline.js',
    """import { debugLog } from '../../config/feature-flags/index.js';
import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { isAutoModeEnabled, sortEntriesByConfigOrder } from '../../config/ordering.js';
import { runtimeState } from '../../config/runtime-state.js';
import { extractSources } from '../dom/sources.js';
import { collectConfigMatches } from './config-matches.js';
import {
    buildUnifiedResults,
    dedupeConfigMatchesByAnzeige,
    extractRawEquipmentItems,
} from './automode.js';
import {
    enrichAussenMergeFromRaw,
    generalizedMergeEntries,
    subsetDedup,
} from './merge-groups.js';
import { openConfigPopup } from './popup-bridge.js';

""",
    pipeline_body,
)

(ROOT / 'src/core/search/popup-bridge.js').write_text(
    """let configPopupOpener = null;

export function registerConfigPopupOpener(fn) {
    configPopupOpener = fn;
}

export function openConfigPopup() {
    if (typeof configPopupOpener === 'function') configPopupOpener();
}
""",
    encoding='utf-8',
)

css_lines = []
inside = False
for line in extract(styles_s, styles_e):
    if 'st.textContent = `' in line:
        inside = True
        continue
    if inside:
        if line.strip() == '`;':
            break
        css_lines.append(line)
(ROOT / 'src/ui/styles/result.css').write_text('\n'.join(css_lines) + '\n', encoding='utf-8')

(ROOT / 'src/ui/styles/inject-result-styles.js').write_text(
    """import resultCss from './result.css?inline';

export function injectResultStyles() {
    if (document.getElementById('mobilede-result-style')) return;
    const st = document.createElement('style');
    st.id = 'mobilede-result-style';
    st.textContent = resultCss;
    document.head.appendChild(st);
}
""",
    encoding='utf-8',
)

write_file(
    ROOT / 'src/ui/results/tech.js',
    """import { debugLog } from '../../config/feature-flags/index.js';
import { isManualScope, shouldApplyOrderToVehicleResults } from '../../config/ordering.js';
import { runtimeState } from '../../config/runtime-state.js';
import { getTechDataDl } from '../../core/dom/selectors.js';
import { injectResultStyles } from '../styles/inject-result-styles.js';

""",
    extract(tech_s, tech_e),
)

write_file(
    ROOT / 'src/ui/results/render.js',
    """import { getFavoriteAnzeigeKeys } from '../../config/list-helpers.js';
import { getResultEntries, openLearnConfig } from '../../core/search/pipeline.js';
import { injectResultStyles } from '../styles/inject-result-styles.js';
import { technischeDatenHinzufuegen } from './tech.js';
import { runtimeState } from '../../config/runtime-state.js';
import { isAutoModeEnabled } from '../../config/ordering.js';

""",
    extract(render_s, render_e),
)

remove_ranges = [
    (render_s, render_e),
    (tech_s, tech_e),
    (styles_s, styles_e),
    (merge2_s, merge2_e),
    (suche_s, suche_e),
    (finalize_s, config_match_e),
    (open_learn_s, open_learn_e),
    (get_result_s, open_learn_s),
    (collect_raw_s, get_result_s),
    (merge_e, collect_raw_s),
    (auto_s, merge_s),
    (merge_s, merge_e),
    (src_s, src_e),
    (sel_s, src_s),
    (match_s, match_e),
    (ordering_s, ordering_e),
]

new_lines = list(lines)
for start, end in sorted(remove_ranges, reverse=True):
    del new_lines[start:end]

imports = """import {
    isAutoModeEnabled,
    getListOrder,
    isManualScope,
    hasAnyManualListScope,
    shouldApplyOrderToVehicleResults,
    getConfigOrderIndexMap,
    sortEntriesByConfigOrder,
    applySaveOrdering,
    orderIndicesByArrayPosition,
} from '../config/ordering.js';
import { collectConfigMatches } from '../core/search/config-matches.js';
import {
    getResultEntries,
    sucheBegriffe,
    finalizeAusstattungResults,
    collectRawConfigHits,
} from '../core/search/pipeline.js';
import { extractSources, classifyDescription } from '../core/dom/sources.js';
import { registerConfigPopupOpener } from '../core/search/popup-bridge.js';
import { ergebnisHinzufuegen, clearResults } from '../ui/results/render.js';

"""

for i, line in enumerate(new_lines):
    if 'bootstrapConfig();' in line:
        new_lines[i + 1:i + 1] = imports.splitlines()
        break

mono_path.write_text('\n'.join(new_lines) + '\n', encoding='utf-8')
print('monolith lines', len(new_lines))
