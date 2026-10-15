/* Responsive adaptation for standard model-produced Plotly figures. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PlotlyResponsive = api;
})(typeof window !== 'undefined' ? window : undefined, function () {
    const MOBILE_WIDTH = 560;
    const DOMAIN_TYPES = new Set(['pie', 'funnelarea', 'sankey', 'treemap', 'sunburst', 'icicle', 'table', 'indicator']);
    const DTYPES = {
        f8: Float64Array, f4: Float32Array,
        i8: BigInt64Array, i4: Int32Array, i2: Int16Array, i1: Int8Array,
        u8: BigUint64Array, u4: Uint32Array, u2: Uint16Array, u1: Uint8Array, b1: Uint8Array
    };
    const labelVisibility = new WeakMap();

    function number(value, fallback) {
        const parsed = Number(value);
        return value !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    }

    function normalizeValue(value) {
        if (ArrayBuffer.isView(value)) return Array.from(value, numericValue);
        if (Array.isArray(value)) return value.map(normalizeValue);
        if (!value || typeof value !== 'object') return value;
        if (typeof value.bdata === 'string' && value.dtype) {
            const Ctor = DTYPES[value.dtype];
            if (!Ctor) throw new Error('Unsupported Plotly dtype: ' + value.dtype);
            const binary = atob(value.bdata);
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            if (bytes.length % Ctor.BYTES_PER_ELEMENT) throw new Error('Invalid Plotly binary array length');
            const flat = Array.from(new Ctor(bytes.buffer), numericValue);
            const shape = typeof value.shape === 'string'
                ? value.shape.split(',').map(part => Number(part.trim()))
                : value.shape;
            if (!Array.isArray(shape) || shape.length < 2) return flat;
            if (shape.some(size => !Number.isInteger(size) || size <= 0) ||
                shape.reduce((total, size) => total * size, 1) !== flat.length) {
                throw new Error('Invalid Plotly binary array shape');
            }
            let offset = 0;
            function reshape(dim) {
                if (dim === shape.length - 1) {
                    const row = flat.slice(offset, offset + shape[dim]);
                    offset += shape[dim];
                    return row;
                }
                return Array.from({ length: shape[dim] }, () => reshape(dim + 1));
            }
            return reshape(0);
        }
        const result = {};
        for (const key of Object.keys(value)) result[key] = normalizeValue(value[key]);
        return result;
    }

    function numericValue(value) {
        if (typeof value !== 'bigint') return value;
        return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(value) : value.toString();
    }

    function entityText(token) {
        const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        const name = token.slice(1, -1);
        if (named[name]) return named[name];
        if (/^#x[\da-f]+$/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16));
        if (/^#\d+$/.test(name)) return String.fromCodePoint(Number(name.slice(1)));
        return token;
    }

    function textWidth(value, size) {
        return Array.from(value).reduce((total, char) =>
            total + size * (/\s/.test(char) ? 0.34 : char.codePointAt(0) < 256 ? 0.58 : 1), 0);
    }

    function plainText(value) {
        return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
            .replace(/&(?:#x[\da-f]+|#\d+|[a-z]+);/gi, entityText);
    }

    function wrapText(value, size, maxWidth) {
        if (typeof value !== 'string' || !value) return { text: value, lines: 0 };
        // Keep tags and entities intact while inserting line breaks between visible characters.
        const tokens = value.match(/<[^>]+>|&(?:#x[\da-f]+|#\d+|[a-z]+);|[\s\S]/gu) || [];
        let text = '';
        let used = 0;
        let lines = 1;
        let small = 0;
        for (const token of tokens) {
            if (/^<br\s*\/?>$/i.test(token) || token === '\n') {
                text += '<br>';
                used = 0;
                lines++;
                continue;
            }
            if (token.startsWith('<')) {
                if (/^<(sup|sub)(?:\s|>)/i.test(token)) small++;
                if (/^<\/(sup|sub)>/i.test(token)) small = Math.max(0, small - 1);
                text += token;
                continue;
            }
            const visible = token.startsWith('&') && token.endsWith(';') ? entityText(token) : token;
            const advance = textWidth(visible, size * (small ? 0.8 : 1));
            if (used && used + advance > Math.max(size, maxWidth)) {
                text += '<br>';
                used = 0;
                lines++;
                if (/^\s$/.test(visible)) continue;
            }
            text += token;
            used += advance;
        }
        return { text, lines };
    }

    function axisKey(ref) {
        return ref[0] + 'axis' + ref.slice(1);
    }

    function rootAxis(ref, layout) {
        const visited = new Set();
        while (!visited.has(ref)) {
            visited.add(ref);
            const overlay = layout[axisKey(ref)] && layout[axisKey(ref)].overlaying;
            if (typeof overlay !== 'string' || !/^[xy]\d*$/.test(overlay)) break;
            ref = overlay;
        }
        return ref;
    }

    function domainOf(value) {
        return Array.isArray(value) && value.length === 2 ? value.slice() : [0, 1];
    }

    function sameDomain(a, b) {
        return Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) < 0.0001;
    }

    function panelsFor(data, layout) {
        const panels = [];
        function add(kind, x, y, traceIndex, xref, yref, subplot) {
            let panel = panels.find(item => sameDomain(item.old.x, x) && sameDomain(item.old.y, y));
            if (!panel) {
                panel = { kind, old: { x, y }, domain: { x: x.slice(), y: y.slice() }, traces: [], xaxes: [], yaxes: [], subplots: [] };
                panels.push(panel);
            }
            panel.traces.push(traceIndex);
            if (xref && !panel.xaxes.includes(xref)) panel.xaxes.push(xref);
            if (yref && !panel.yaxes.includes(yref)) panel.yaxes.push(yref);
            if (subplot && !panel.subplots.includes(subplot)) panel.subplots.push(subplot);
        }
        data.forEach((trace, i) => {
            const type = trace.type || 'scatter';
            if (DOMAIN_TYPES.has(type)) {
                add(type, domainOf(trace.domain && trace.domain.x), domainOf(trace.domain && trace.domain.y), i);
            } else if (/polar$/.test(type)) {
                const ref = trace.subplot || 'polar';
                layout[ref] = layout[ref] || {};
                add('polar', domainOf(layout[ref].domain && layout[ref].domain.x),
                    domainOf(layout[ref].domain && layout[ref].domain.y), i, null, null, ref);
            } else if (/^(scatter3d|surface|mesh3d|cone|streamtube|volume|isosurface)$/.test(type)) {
                const ref = trace.scene || 'scene';
                layout[ref] = layout[ref] || {};
                add('scene', domainOf(layout[ref].domain && layout[ref].domain.x),
                    domainOf(layout[ref].domain && layout[ref].domain.y), i, null, null, ref);
            } else if (/^(scattergeo|choropleth|scattermapbox|choroplethmapbox|scattermap|choroplethmap|scatterternary)$/.test(type)) {
                const ref = trace.geo || trace.subplot || (type.includes('ternary') ? 'ternary' : type.includes('mapbox') ? 'mapbox' : type.includes('map') ? 'map' : 'geo');
                layout[ref] = layout[ref] || {};
                add(ref.replace(/\d+$/, ''), domainOf(layout[ref].domain && layout[ref].domain.x),
                    domainOf(layout[ref].domain && layout[ref].domain.y), i, null, null, ref);
            } else {
                const x = trace.xaxis || 'x';
                const y = trace.yaxis || 'y';
                const baseX = rootAxis(x, layout);
                const baseY = rootAxis(y, layout);
                for (const ref of [x, y, baseX, baseY]) layout[axisKey(ref)] = layout[axisKey(ref)] || {};
                add('cartesian', domainOf(layout[axisKey(baseX)].domain), domainOf(layout[axisKey(baseY)].domain), i, x, y);
            }
        });
        for (const panel of panels) {
            for (const ref of panel.xaxes.slice()) {
                const base = rootAxis(ref, layout);
                if (!panel.xaxes.includes(base)) panel.xaxes.push(base);
            }
            for (const ref of panel.yaxes.slice()) {
                const base = rootAxis(ref, layout);
                if (!panel.yaxes.includes(base)) panel.yaxes.push(base);
            }
        }
        return panels.sort((a, b) => Math.abs(a.old.y[1] - b.old.y[1]) > 0.01
            ? b.old.y[1] - a.old.y[1] : a.old.x[0] - b.old.x[0]);
    }

    function headingPanel(annotation, panels) {
        if (annotation.showarrow !== false || annotation.xref !== 'paper' || annotation.yref !== 'paper') return null;
        return panels.find(panel => Math.abs(Number(annotation.y) - panel.old.y[1]) < 0.006 &&
            Number(annotation.x) >= panel.old.x[0] - 0.01 && Number(annotation.x) <= panel.old.x[1] + 0.01) || null;
    }

    function mapCoordinate(value, oldDomain, nextDomain) {
        return nextDomain[0] + (Number(value) - oldDomain[0]) / (oldDomain[1] - oldDomain[0]) * (nextDomain[1] - nextDomain[0]);
    }

    function stackPanels(data, layout, panels, plotWidth) {
        const horizontal = panels.some((a, i) => panels.slice(i + 1).some(b =>
            !sameDomain(a.old.x, b.old.x) && Math.min(a.old.y[1], b.old.y[1]) - Math.max(a.old.y[0], b.old.y[0]) > 0.05));
        if (!horizontal) return false;
        const annotations = layout.annotations || [];
        let total = 0;
        for (const [i, panel] of panels.entries()) {
            panel.pixelHeight = panel.kind === 'cartesian' ? 240 : panel.kind === 'polar' ? 280 : 300;
            const lines = annotations.filter(a => headingPanel(a, panels) === panel)
                .reduce((max, a) => Math.max(max, wrapText(a.text, 14, plotWidth - 12).lines), 0);
            panel.gapBefore = i ? 48 + Math.max(20, lines * 18) + 12 : 0;
            total += panel.pixelHeight + panel.gapBefore;
        }
        let cursor = total;
        for (const panel of panels) {
            cursor -= panel.gapBefore;
            panel.domain = { x: [0, 1], y: [(cursor - panel.pixelHeight) / total, cursor / total] };
            cursor -= panel.pixelHeight;
            for (const ref of panel.xaxes) layout[axisKey(ref)].domain = [0, 1];
            for (const ref of panel.yaxes) {
                if (!layout[axisKey(ref)].overlaying) layout[axisKey(ref)].domain = panel.domain.y.slice();
            }
            for (const ref of panel.subplots) {
                layout[ref].domain = normalizeValue(panel.domain);
            }
            for (const i of panel.traces) {
                if (DOMAIN_TYPES.has(data[i].type)) data[i].domain = normalizeValue(panel.domain);
            }
        }
        for (const annotation of annotations) {
            if (annotation.xref !== 'paper' || annotation.yref !== 'paper') continue;
            const heading = headingPanel(annotation, panels);
            const panel = heading || panels.find(p => Number(annotation.x) >= p.old.x[0] &&
                Number(annotation.x) <= p.old.x[1] && Number(annotation.y) >= p.old.y[0] && Number(annotation.y) <= p.old.y[1]);
            if (panel) {
                annotation.x = mapCoordinate(annotation.x, panel.old.x, panel.domain.x);
                annotation.y = mapCoordinate(annotation.y, panel.old.y, panel.domain.y);
            }
        }
        // A paper-referenced shape belongs to a panel only when both corners lie in that panel.
        for (const shape of layout.shapes || []) {
            if (shape.xref !== 'paper' || shape.yref !== 'paper') continue;
            const panel = panels.find(p => [shape.x0, shape.x1].every(x => x >= p.old.x[0] && x <= p.old.x[1]) &&
                [shape.y0, shape.y1].every(y => y >= p.old.y[0] && y <= p.old.y[1]));
            if (!panel) continue;
            for (const key of ['x0', 'x1']) shape[key] = mapCoordinate(shape[key], panel.old.x, panel.domain.x);
            for (const key of ['y0', 'y1']) shape[key] = mapCoordinate(shape[key], panel.old.y, panel.domain.y);
        }
        // Free secondary axes use positions in paper coordinates.
        for (const panel of panels) {
            for (const ref of panel.yaxes) {
                const axis = layout[axisKey(ref)];
                if (axis.anchor === 'free' && typeof axis.position === 'number') {
                    axis.position = mapCoordinate(axis.position, panel.old.x, panel.domain.x);
                }
            }
        }
        return true;
    }

    function repairHierarchy(trace, warnings) {
        if (!['treemap', 'sunburst', 'icicle'].includes(trace.type) || !Array.isArray(trace.labels) || !Array.isArray(trace.parents)) return;
        const ids = Array.isArray(trace.ids) ? trace.ids : trace.labels;
        if (trace.parents.length !== ids.length) {
            // A missing first root slot is repairable only when shifted metadata
            // independently identifies every leaf and the proposed tree is acyclic.
            const count = ids.length;
            const metadata = trace.customdata;
            const shifted = trace.parents.length === count - 1 && String(trace.parents[0]) === String(ids[0]) &&
                Array.isArray(metadata) && metadata.length === count - 1 && metadata.some(Array.isArray) &&
                metadata.every((row, i) => row == null || Array.isArray(row) &&
                    (row.includes(trace.labels[i + 1]) || row.includes(ids[i + 1])));
            const proposed = ['', ...trace.parents];
            const index = new Map(ids.map((id, i) => [String(id), i]));
            const valid = shifted && index.size === count && proposed.every((parent, i) => {
                const seen = new Set([i]);
                while (parent !== '' && parent != null) {
                    const next = index.get(String(parent));
                    if (next === undefined || seen.has(next)) return false;
                    seen.add(next);
                    parent = proposed[next];
                }
                return true;
            });
            if (!valid) throw new Error('Invalid hierarchy array alignment; cannot infer missing parent entries.');
            trace.parents = proposed;
            for (const key of ['customdata', 'text', 'hovertext', 'hovertemplate']) {
                if (Array.isArray(trace[key]) && trace[key].length === count - 1) trace[key].unshift(null);
            }
            warnings.push('层级图缺少根节点的 parents/customdata 首项；已由叶节点元数据对应关系确认并补齐，数值与颜色保留。');
        }
        const known = new Set(ids.map(String));
        const missing = [...new Set(trace.parents.filter(parent => parent !== '' && parent !== null).map(String))]
            .filter(parent => !known.has(parent));
        const originalCount = trace.labels.length;
        for (const parent of missing) {
            const children = trace.parents.map((value, i) => String(value) === parent ? i : -1).filter(i => i >= 0);
            const first = children[0];
            trace.labels.push(parent);
            trace.parents.push('');
            if (Array.isArray(trace.ids)) trace.ids.push(parent);
            if (Array.isArray(trace.values)) {
                trace.values.push(trace.branchvalues === 'total'
                    ? children.reduce((sum, i) => sum + number(trace.values[i], 0), 0) : 0);
            }
            for (const key of ['text', 'hovertext', 'customdata', 'hovertemplate']) {
                if (Array.isArray(trace[key]) && trace[key].length >= originalCount) trace[key].push(trace[key][first]);
            }
            if (trace.marker && Array.isArray(trace.marker.colors)) trace.marker.colors.push(trace.marker.colors[first]);
        }
        if (missing.length) warnings.push('补齐层级图缺失父节点：' + missing.join('、') + '；total 父值由现有子节点求和。');
        if (trace.branchvalues === undefined && Array.isArray(trace.values) && trace.values.length === trace.labels.length &&
            trace.values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
            const sums = new Map();
            trace.parents.forEach((parent, i) => {
                if (parent !== '' && parent != null) sums.set(String(parent), (sums.get(String(parent)) || 0) + trace.values[i]);
            });
            const tolerance = value => Math.max(1, value) * 1e-6;
            const aggregateRoot = trace.parents.some((parent, i) => (parent === '' || parent == null) &&
                sums.has(String(ids[i])) && trace.values[i] > 0 &&
                Math.abs(trace.values[i] - sums.get(String(ids[i]))) <= tolerance(trace.values[i]));
            const validTotals = trace.labels.every((label, i) => !sums.has(String(ids[i])) ||
                trace.values[i] + tolerance(trace.values[i]) >= sums.get(String(ids[i])));
            if (aggregateRoot && validTotals) {
                trace.branchvalues = 'total';
                warnings.push('层级图根值等于直属子节点之和，且所有父值覆盖子值；按 total 解释面积，保留原数值。');
            }
        }
    }

    function fitAxes(data, layout, panels, plotWidth, warnings) {
        for (const [key, axis] of Object.entries(layout)) {
            if (!/^[xy]axis\d*$/.test(key) || !axis) continue;
            axis.automargin = true;
            axis.tickfont = Object.assign({}, axis.tickfont, { size: Math.min(number(axis.tickfont && axis.tickfont.size, 10), 10) });
            if (key[0] === 'x') axis.ticklabelstandoff = Math.max(number(axis.ticklabelstandoff, 0), 8);
            if (axis.title) {
                axis.title = typeof axis.title === 'string' ? { text: axis.title } : axis.title;
                axis.title.font = Object.assign({}, axis.title.font, { size: Math.min(number(axis.title.font && axis.title.font.size, 11), 11) });
                if (key[0] === 'y') axis.title.text = wrapText(axis.title.text, 11, 190).text;
                axis.title.standoff = Math.min(number(axis.title.standoff, 10), 10);
            }
            if (key[0] !== 'x' || axis.tickvals || axis.showticklabels === false) continue;
            const ref = key[0] + key.slice(5);
            const traces = data.filter(t => (t.xaxis || 'x') === ref && Array.isArray(t.x) && t.x.length);
            const values = traces.flatMap(t => t.x);
            const categories = [...new Set(values.filter(value => typeof value === 'string'))];
            const dates = categories.map(value => /^\d{4}-\d\d-\d\d(?:T|$)/.test(value) ? Date.parse(value.slice(0, 10)) : NaN).sort((a, b) => a - b);
            const gaps = dates.slice(1).map((value, i) => value - dates[i]).filter(gap => gap > 0);
            if (!axis.type && !axis.range && !axis.matches && !axis.rangebreaks && traces.length &&
                traces.every(trace => trace.type === 'bar' && trace.orientation !== 'h') && categories.length >= 2 && categories.length <= 12 &&
                dates.every(Number.isFinite) && gaps.length && Math.min(...gaps) / (dates.at(-1) - dates[0]) * plotWidth < 3) {
                Object.assign(axis, { type: 'category', categoryorder: 'array', categoryarray: categories.slice() });
                warnings.push('稀疏日期柱形按事件类别排列，以保证柱宽；日期和数值保留，横轴不表示连续时间间隔。');
            }
            const categoryAxis = axis.type === 'category' || axis.type === 'multicategory' ||
                (categories.length && categories.every(value => !/^\d{4}-\d\d(?:-\d\d)?(?:T|$)/.test(value)));
            if (axis.type === 'multicategory') continue;
            if (categoryAxis && categories.length) {
                const slots = Math.max(2, Math.floor(plotWidth / 62));
                const picked = categories.length > slots
                    ? Array.from({ length: slots }, (_, i) => categories[Math.round(i * (categories.length - 1) / (slots - 1))])
                    : categories;
                axis.tickmode = 'array';
                axis.tickvals = picked;
                // Sampling can leave adjacent categories; their positions do not spread out.
                const indices = picked.map(value => categories.indexOf(value));
                const minimumGap = indices.slice(1).reduce((gap, index, i) => Math.min(gap, index - indices[i]), categories.length);
                const labelWidth = plotWidth * minimumGap / categories.length - 8;
                axis.ticktext = picked.map(value => wrapText(value, 10, Math.max(20, labelWidth)).text);
                axis.tickangle = 0;
            } else {
                axis.nticks = Math.min(number(axis.nticks, 4), 4);
            }
        }
        for (const panel of panels) {
            if (panel.kind !== 'polar') continue;
            for (const ref of panel.subplots) {
                for (const key of ['angularaxis', 'radialaxis']) {
                    const axis = layout[ref][key] = layout[ref][key] || {};
                    axis.tickfont = Object.assign({}, axis.tickfont, { size: 10 });
                    if (key === 'angularaxis' && !axis.tickvals && axis.type !== 'linear') {
                        const categories = [...new Set(panel.traces.flatMap(i => Array.isArray(data[i].theta) ? data[i].theta : []))];
                        if (categories.length && categories.every(value => typeof value === 'string' && !Number.isFinite(Number(value)))) {
                            const labelWidth = Math.max(40, Math.min(60, plotWidth / 4));
                            axis.tickmode = 'array';
                            axis.tickvals = categories;
                            axis.ticktext = categories.map(value => textWidth(value, 10) > labelWidth
                                ? value.split(/\s+/).map(word => wrapText(word, 10, labelWidth).text).join('<br>') : value);
                        }
                    }
                    if (key === 'radialaxis' && !axis.tickvals && !axis.dtick) {
                        axis.nticks = Math.min(number(axis.nticks, 4), 4);
                    }
                }
            }
        }
    }

    function colorbarBands(data, layout, plotWidth) {
        const bars = [];
        const shared = new Set();
        function add(owner) {
            owner.colorbar = owner.colorbar || {};
            if (!bars.includes(owner.colorbar)) bars.push(owner.colorbar);
        }
        for (const trace of data) {
            if (trace.visible === false || trace.visible === 'legendonly') continue;
            for (const owner of [trace, trace.marker]) {
                if (!owner) continue;
                if (owner.coloraxis) { shared.add(owner.coloraxis); continue; }
                if (owner.showscale === false) continue;
                if (owner.colorbar || owner === trace && ['heatmap', 'contour', 'surface'].includes(trace.type) ||
                    owner.showscale === true) add(owner);
            }
        }
        for (const ref of shared) {
            const axis = layout[ref] = layout[ref] || {};
            if (axis.showscale !== false) add(axis);
        }
        return bars.map(bar => {
            const title = typeof bar.title === 'string' ? { text: bar.title } : bar.title || {};
            const wrapped = wrapText(title.text, 11, plotWidth - 8);
            Object.assign(bar, {
                orientation: 'h', xref: 'paper', yref: 'paper', x: 0.5, xanchor: 'center', yanchor: 'top',
                lenmode: 'fraction', len: 1, thicknessmode: 'pixels', thickness: 12, xpad: 0, ypad: 0,
                tickfont: Object.assign({}, bar.tickfont, { size: 10 }),
                title: Object.assign({}, title, { text: wrapped.text, side: 'top', font: Object.assign({}, title.font, { size: 11 }) })
            });
            if (!bar.tickvals && !bar.dtick) bar.nticks = Math.min(number(bar.nticks, 4), 4);
            return { bar, height: 38 + wrapped.lines * 15 };
        });
    }

    function legendMetrics(data, layout, availableWidth, fontSize = 11, columns = false) {
        if (layout.showlegend === false || (layout.legend && layout.legend.visible === false)) return { height: 0, rows: 0 };
        const entries = [];
        for (const [i, trace] of data.entries()) {
            if (trace.showlegend === false || trace.visible === false) continue;
            if (['pie', 'funnelarea'].includes(trace.type) && Array.isArray(trace.labels)) {
                const originalLabels = trace.labels.slice();
                trace.labels = trace.labels.map(label => wrapText(String(label), fontSize, Math.max(70, availableWidth - 54)).text);
                entries.push(...trace.labels);
                if (!trace.hovertemplate && !trace.hovertext) {
                    trace.hovertext = originalLabels;
                    trace.hovertemplate = '%{hovertext}<br>%{value}<br>%{percent}<extra></extra>';
                }
            } else if (!DOMAIN_TYPES.has(trace.type) && (trace.name || trace.showlegend === true || data.length > 1)) {
                trace.name = wrapText(String(trace.name || 'trace ' + i), fontSize, Math.max(70, availableWidth - 54)).text;
                entries.push(trace.name);
            }
        }
        if (!entries.length) return { height: 0, rows: 0 };
        if (columns && !data.some(trace => trace.legendgroup || trace.legendgrouptitle && trace.legendgrouptitle.text)) {
            const widest = Math.max(...entries.map(text => Math.max(...plainText(text).split('\n').map(line => textWidth(line, fontSize))) + 54));
            const count = Math.max(1, Math.min(entries.length, Math.floor(availableWidth / widest)));
            const rows = Math.ceil(entries.length / count);
            const rowHeight = Math.max(...entries.map(text => plainText(text).split('\n').length * (fontSize + 3) + 5));
            return { height: rows * rowHeight + 8, rows, columns: count };
        }
        let used = 0;
        let rowHeight = 0;
        let height = 0;
        let rows = 1;
        for (const text of entries) {
            const lines = plainText(text).split('\n');
            const itemWidth = Math.min(availableWidth, Math.max(...lines.map(line => textWidth(line, fontSize))) + 54);
            const itemHeight = lines.length * (fontSize + 5) + 8;
            if (used && used + itemWidth > availableWidth) {
                height += rowHeight;
                rows++;
                used = 0;
                rowHeight = 0;
            }
            used += itemWidth;
            rowHeight = Math.max(rowHeight, itemHeight);
        }
        return { height: height + rowHeight + 8, rows };
    }

    function axisFootPixels(panel, layout) {
        let pixels = 8;
        for (const ref of panel.xaxes) {
            const axis = layout[axisKey(ref)];
            if (axis.showticklabels === false) continue;
            const lines = (axis.ticktext || []).reduce((max, text) => Math.max(max, plainText(text).split('\n').length), 1);
            const titleHeight = axis.title && axis.title.text ? 22 : 0;
            pixels = Math.max(pixels, 42 + titleHeight, lines * 13 + 12 + titleHeight);
        }
        return pixels;
    }

    function minimumPlotHeight(panels, layout) {
        let pixels = panels.length ? 300 : 300;
        for (const panel of panels) {
            const span = panel.domain.y[1] - panel.domain.y[0];
            if (span <= 0) continue;
            const target = panel.kind === 'cartesian' ? 160 : panel.kind === 'polar' ? 240 : 260;
            pixels = Math.max(pixels, Math.ceil(target / span));
        }
        for (const [i, upper] of panels.entries()) {
            const lower = panels.slice(i + 1).find(p => sameDomain(p.domain.x, upper.domain.x) && p.domain.y[1] <= upper.domain.y[0] + 0.0001);
            if (!lower) continue;
            const gap = upper.domain.y[0] - lower.domain.y[1];
            if (gap <= 0) continue;
            const headingLines = (layout.annotations || []).filter(a => a.xref === 'paper' && a.yref === 'paper' &&
                a.showarrow === false && Math.abs(a.y - lower.domain.y[1]) < 0.006)
                .reduce((max, a) => Math.max(max, plainText(a.text).split('\n').length), 0);
            const upperTicks = axisFootPixels(upper, layout);
            pixels = Math.max(pixels, Math.ceil((upperTicks + headingLines * 18 + 10) / gap));
        }
        return pixels;
    }

    function rgbaColor(value) {
        if (typeof value !== 'string') return null;
        const named = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff',
            green: '#008000', gray: '#808080', grey: '#808080', navy: '#000080',
            orange: '#ffa500', yellow: '#ffff00', gold: '#ffd700', transparent: '#00000000' };
        value = named[value.toLowerCase().trim()] || value.trim();
        const hex = value.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i);
        if (hex) {
            const digits = hex[1].length < 5 ? Array.from(hex[1], digit => digit + digit).join('') : hex[1];
            return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16))
                .concat(digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1);
        }
        const rgb = value.match(/^rgba?\(\s*([\d.]+)(%)?\s*,\s*([\d.]+)(%)?\s*,\s*([\d.]+)(%)?(?:\s*,\s*([\d.]+)(%)?)?\s*\)$/i);
        if (!rgb) return null;
        return [1, 3, 5].map(i => Math.min(255, Number(rgb[i]) * (rgb[i + 1] ? 2.55 : 1)))
            .concat(rgb[7] === undefined ? 1 : Math.min(1, Number(rgb[7]) / (rgb[8] ? 100 : 1)));
    }

    function compositeColor(foreground, background) {
        return foreground.slice(0, 3).map((value, i) => Math.round(value * foreground[3] + background[i] * (1 - foreground[3])));
    }

    function luminance(rgb) {
        const linear = rgb.slice(0, 3).map(value => value / 255 <= 0.04045 ? value / 255 / 12.92 : Math.pow((value / 255 + 0.055) / 1.055, 2.4));
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }

    function colorContrast(foreground, background) {
        const fg = luminance(compositeColor(foreground, background));
        const bg = luminance(background);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    }

    function protectDataAnnotations(layout, plotWidth, mobile, warnings) {
        const template = layout.template && layout.template.layout || {};
        const paper = compositeColor(rgbaColor(layout.paper_bgcolor || template.paper_bgcolor) || [255, 255, 255, 1], [255, 255, 255]);
        const plot = compositeColor(rgbaColor(layout.plot_bgcolor || template.plot_bgcolor) || [...paper, 1], paper);
        for (const annotation of layout.annotations || []) {
            const xref = annotation.xref || 'x';
            const yref = annotation.yref || 'y';
            if (annotation.visible === false || annotation.showarrow !== false ||
                !/^x\d*(?: domain)?$/.test(xref) && !/^y\d*(?: domain)?$/.test(yref)) continue;
            const authoredSurface = rgbaColor(annotation.bgcolor);
            const surface = authoredSurface ? compositeColor(authoredSurface, plot) : plot;
            // A transparent box leaves text contrast dependent on the curve below it.
            if (!authoredSurface || authoredSurface[3] < 1) annotation.bgcolor = 'rgb(' + surface.join(', ') + ')';
            const font = annotation.font = Object.assign({}, annotation.font);
            const authoredText = rgbaColor(font.color);
            if (!font.color || authoredText && colorContrast(authoredText, surface) < 4.5) {
                const neutrals = ['#111827', '#F9FAFB', '#000000', '#FFFFFF'];
                font.color = neutrals.find(color => colorContrast(rgbaColor(color), surface) >= 4.5);
            } else if (!authoredText) {
                warnings.push('图内注释使用未解析的文字颜色；保留原色，对比度需在实际渲染中确认。');
            }
            const size = number(font.size, 12);
            font.size = mobile ? Math.max(12, Math.min(size, 14)) : Math.max(12, size);
            if (mobile) annotation.text = wrapText(annotation.text, font.size, Math.max(40, plotWidth - 12)).text;
            annotation.borderpad = Math.max(number(annotation.borderpad, 4), 4);
            const reference = (layout.shapes || []).find(shape => shape.type === 'line' &&
                (shape.xref || 'x') === xref && (shape.yref || 'y') === yref &&
                / domain$/.test(xref) && Number(shape.x0) === 0 && Number(shape.x1) === 1 &&
                shape.y0 === annotation.y && shape.y1 === annotation.y);
            if (!annotation.bordercolor || rgbaColor(annotation.bordercolor)?.[3] === 0) {
                annotation.bordercolor = reference && reference.line && reference.line.color ||
                    (luminance(surface) > 0.4 ? '#CBD5E1' : '#64748B');
            }
            if (annotation.borderwidth === undefined) annotation.borderwidth = 1;
        }
    }

    // Long outward labels at a data endpoint can dominate Plotly's autorange.
    // Keep the data anchor as a small key; put the complete explanation below.
    function compactEndpointAnnotations(data, layout, plotWidth, warnings) {
        const notes = [];
        function coordinate(value) {
            if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
            return typeof value === 'string' && /^\d{4}-\d\d-\d\d(?:T| |$)/.test(value) ? Date.parse(value) : NaN;
        }
        for (const [annotationIndex, annotation] of (layout.annotations || []).entries()) {
            const ref = annotation.xref || 'x';
            if (annotation.visible === false || annotation.showarrow !== false || !/^x\d*$/.test(ref) ||
                !/^y\d*$/.test(annotation.yref || 'y') || !['left', 'right'].includes(annotation.xanchor) ||
                annotation.textangle || annotation.xshift || annotation.yshift || annotation.templateitemname) continue;
            const refs = new Set([ref]);
            const axes = Object.entries(layout).filter(([key]) => /^xaxis\d*$/.test(key));
            for (let pass = 0; pass < axes.length; pass++) for (const [key, axis] of axes) {
                const keyRef = key.replace('axis', '');
                if (axis.matches && (refs.has(keyRef) || refs.has(axis.matches))) { refs.add(keyRef); refs.add(axis.matches); }
            }
            if ([...refs].some(id => {
                const axis = layout[axisKey(id)] || {};
                return axis.range || axis.autorange === false || axis.autorange === 'reversed' || axis.scaleanchor ||
                    axis.calendar && axis.calendar !== 'gregorian' || axis.type && !['linear', 'date'].includes(axis.type);
            })) continue;
            const values = data.filter(trace => refs.has(trace.xaxis || 'x') && trace.visible !== false && trace.visible !== 'legendonly')
                .flatMap(trace => Array.isArray(trace.x) ? trace.x : []).filter(value => value !== null && value !== undefined);
            const positions = values.map(coordinate), x = coordinate(annotation.x);
            if (positions.length < 2 || positions.some(value => !Number.isFinite(value)) || !Number.isFinite(x)) continue;
            const min = Math.min(...positions), max = Math.max(...positions);
            if (max <= min) continue;
            const right = Math.abs(x - max) <= (max - min) * 1e-9 && annotation.xanchor === 'left';
            const left = Math.abs(x - min) <= (max - min) * 1e-9 && annotation.xanchor === 'right';
            const size = Math.max(12, number(annotation.font && annotation.font.size, 12));
            if ((!right && !left) || Math.max(...plainText(annotation.text).split('\n').map(line => textWidth(line, size))) < Math.max(80, plotWidth * 0.28)) continue;
            const label = '[' + (notes.length + 1) + ']';
            notes.push({ annotationIndex, label, text: annotation.text, x: annotation.x, y: annotation.y, xref: ref, yref: annotation.yref || 'y' });
            annotation.hovertext = [annotation.text, annotation.hovertext].filter(Boolean).join('<br>');
            annotation.text = label;
            annotation.xanchor = right ? 'right' : 'left';
        }
        if (notes.length) {
            for (const note of notes) {
                const original = layout.annotations[note.annotationIndex];
                const value = typeof note.y === 'number' ? Number(note.y.toPrecision(8)) : note.y;
                layout.annotations.push({ text: note.label + '（' + value + '）' + note.text,
                    x: 0, y: -1, xref: 'paper', yref: 'paper', xanchor: 'left', yanchor: 'top',
                    align: 'left', showarrow: false, font: { size: 12, color: original.font && original.font.color } });
            }
            warnings.push('窄屏端点长标注已改为图内编号和图下完整说明；坐标锚点、数据与自动轴范围保留。');
        }
        return notes;
    }

    function titleYear(button) {
        const title = button.args && button.args[1] && button.args[1].title;
        const text = typeof title === 'string' ? title : title && title.text;
        const match = text && text.match(/(?:（|\()(\d{4})(?:，|,|）|\))/);
        return match && match[1];
    }

    // Scatter attributes whose arrays are indexed by point. Do not slice trace-level
    // arrays such as colorscale, meta or selectedpoints merely because lengths match.
    const POINT_PATHS = [
        'x', 'y', 'ids', 'text', 'hovertext', 'customdata', 'hovertemplate', 'texttemplate', 'textposition',
        ...['size', 'color', 'opacity', 'symbol', 'angle', 'standoff', 'line.color', 'line.width'].map(key => 'marker.' + key),
        ...['size', 'color', 'family', 'weight', 'style', 'variant', 'lineposition', 'textcase', 'shadow'].map(key => 'textfont.' + key),
        ...['x', 'y'].flatMap(axis => ['array', 'arrayminus'].map(key => 'error_' + axis + '.' + key))
    ];

    function atPath(object, path) {
        return path.split('.').reduce((value, key) => value && value[key], object);
    }

    function setPath(object, path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        const parent = keys.reduce((next, key) => next[key] || (next[key] = {}), object);
        parent[last] = value;
    }

    function repairYearMenu(data, layout, options, warnings, frames) {
        if (!data.length || frames && frames.length) return [];
        const candidates = [];
        (layout.updatemenus || []).forEach((menu, menuIndex) => {
            const buttons = menu.buttons || [];
            const years = buttons.map(titleYear);
            // Existing data commands, toggle buttons and app-managed commands are authoritative.
            if (menu.visible === false || menu.templateitemname || buttons.length < 2 ||
                years.some(year => !year) || new Set(years).size !== years.length ||
                buttons.some((button, i) => button.visible === false || button.templateitemname ||
                    button.method !== 'update' || button.execute === false || button.args2 ||
                    button.label && button.label !== years[i] || button.args.length !== 2 ||
                    !button.args[0] || typeof button.args[0] !== 'object' || Array.isArray(button.args[0]) ||
                    Object.keys(button.args[0] || {}).some(key => key !== 'visible') ||
                    Object.keys(button.args[1] || {}).some(key => key !== 'title') ||
                    !Array.isArray(button.args[0].visible) || button.args[0].visible.length !== data.length ||
                    button.args[0].visible.some(value => value !== true))) return;
            const yearSet = new Set(years);
            const bindings = data.map(trace => {
                if ((trace.type || 'scatter') !== 'scatter' || trace.transforms || trace.selectedpoints !== undefined ||
                    !Array.isArray(trace.x) || !Array.isArray(trace.y) || trace.x.length !== trace.y.length ||
                    !Array.isArray(trace.customdata) || trace.customdata.length !== trace.x.length ||
                    !trace.customdata.length || !trace.customdata.every(Array.isArray)) return null;
                const paths = POINT_PATHS.filter(path => Array.isArray(atPath(trace, path)));
                if (paths.some(path => atPath(trace, path).length !== trace.x.length)) return null;
                const columns = trace.customdata[0].map((_, column) => column).filter(column => {
                    const values = trace.customdata.map(row => String(row[column]));
                    return values.every(year => yearSet.has(year)) && new Set(values).size === years.length &&
                        values.every((year, i) => {
                            const evidence = [trace.hovertext, trace.text].filter(Array.isArray)
                                .flatMap(array => plainText(array[i]).match(/\b(?:19|20)\d{2}\b/g) || [])
                                .filter(value => yearSet.has(value));
                            return evidence.length > 0 && evidence.every(value => value === year);
                        });
                });
                return columns.length === 1 ? { column: columns[0], paths } : null;
            });
            if (bindings.every(Boolean)) candidates.push({ menu, menuIndex, years, bindings });
        });
        // Two independent filters of the same full point arrays require explicit composition.
        if (candidates.length !== 1) return [];
        const { menu, menuIndex, years, bindings } = candidates[0];
        const values = ['all', ...years];
        const paths = [...new Set(bindings.flatMap(binding => binding.paths))];
        function payload(value) {
            const update = {};
            for (const path of paths) {
                update[path] = data.map((trace, i) => {
                    const array = atPath(trace, path);
                    if (!Array.isArray(array)) return undefined; // Plotly skips this trace for the attribute.
                    return array.filter((_, j) => value === 'all' || String(trace.customdata[j][bindings[i].column]) === value);
                });
            }
            return update;
        }
        const fullTitle = normalizeValue(layout.title);
        menu.buttons = [
            { label: 'all', method: 'update', args: [{ visible: data.map(() => true) }, { title: fullTitle }] },
            ...menu.buttons
        ].map((button, i) => Object.assign({}, button, {
            label: values[i], name: 'responsive-year-' + menuIndex + ':' + values[i],
            args: [Object.assign({}, button.args[0], payload(values[i])), button.args[1]]
        }));
        const requested = options.yearSelections && String(options.yearSelections[menuIndex]);
        menu.active = Math.max(0, values.indexOf(requested));
        menu.showactive = true;
        // Keep this repaired filter a dropdown at every width. Plotly 4.1.1 can
        // retain the old SVG header when react changes a menu's type to buttons.
        menu.type = 'dropdown';
        menu.direction = 'up';
        const selected = menu.buttons[menu.active];
        if (menu.active) {
            // Apply the same point mask to all per-point arrays, keeping missing numeric values intact.
            for (const path of paths) data.forEach((trace, i) => {
                const array = selected.args[0][path][i];
                if (array !== undefined) setPath(trace, path, array);
            });
            const selectedTitle = selected.args[1].title;
            layout.title = Object.assign({}, typeof fullTitle === 'string' ? { text: fullTitle } : fullTitle,
                typeof selectedTitle === 'string' ? { text: selectedTitle } : normalizeValue(selectedTitle));
        }
        warnings.push('年份按钮缺少数据筛选参数；已由逐点年份元数据与文字确认绑定，默认 all 显示全部年份。');
        return [{ menuIndex, values, buttonNames: menu.buttons.map(button => button.name) }];
    }

    function headerFromTitle(value, layout, mobile) {
        const title = typeof value === 'string' ? { text: value } : normalizeValue(value || {});
        const size = number(title.font && title.font.size, mobile ? 16 : 18);
        title.font = Object.assign({}, layout.font, title.font);
        title.font.size = mobile ? Math.min(size, 16) : size;
        return title;
    }

    // Keep only Plotly's text formatting subset; model HTML is never inserted directly.
    function renderHeader(element, header) {
        element.replaceChildren();
        element.hidden = !header || !header.text && !(header.subtitle && header.subtitle.text);
        if (element.hidden) return;
        const doc = element.ownerDocument;
        element.style.overflowWrap = 'anywhere';
        element.style.minWidth = '0';
        function appendText(value, target) {
            const template = doc.createElement('template');
            template.innerHTML = String(value || '');
            function copy(node, parent) {
                if (node.nodeType === 3) { parent.appendChild(doc.createTextNode(node.textContent)); return; }
                if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) return;
                let next = parent;
                if (['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUP', 'SUB', 'BR', 'SPAN'].includes(node.tagName)) {
                    next = doc.createElement(node.tagName.toLowerCase());
                    if (node.tagName === 'SPAN') {
                        for (const property of ['color', 'font-size', 'font-weight', 'font-style', 'text-decoration']) {
                            const value = node.style.getPropertyValue(property);
                            if (value && !/url\s*\(|expression|var\s*\(/i.test(value)) next.style.setProperty(property, value);
                        }
                    }
                    parent.appendChild(next);
                }
                for (const child of node.childNodes) copy(child, next);
            }
            for (const child of template.content.childNodes) copy(child, target);
        }
        for (const [index, item] of [header, header.subtitle || {}].entries()) {
            if (!item.text) continue;
            const node = doc.createElement(index ? 'p' : 'h4');
            const font = Object.assign({}, header.font, item.font);
            node.style.margin = index ? '4px 0 0' : '0';
            node.style.lineHeight = '1.5';
            node.style.fontSize = Math.max(11, number(font.size, index ? 13 : 16)) + 'px';
            if (index && !(item.font && item.font.size)) node.style.fontSize = Math.max(11, number(header.font.size, 16) * 0.8) + 'px';
            node.style.fontWeight = index ? '400' : '600';
            if (font.family) node.style.fontFamily = font.family;
            if (font.color) node.style.color = font.color;
            appendText(item.text, node);
            element.appendChild(node);
        }
    }

    function extractTitleUpdates(layout, mobile) {
        const updates = [];
        (layout.updatemenus || []).forEach((menu, menuIndex) => (menu.buttons || []).forEach((button, buttonIndex) => {
            const update = { menuIndex, buttonIndex };
            for (const [index, args] of [button.args, button.args2].entries()) {
                const patch = args && args[button.method === 'update' ? 1 : button.method === 'relayout' ? 0 : -1];
                if (!patch || typeof patch !== 'object' || Array.isArray(patch)) continue;
                const keys = Object.keys(patch).filter(key => key === 'title' || key.startsWith('title.'));
                if (!keys.length) continue;
                let title = normalizeValue(layout.title || {});
                if (typeof title === 'string') title = { text: title };
                if (patch.title !== undefined) Object.assign(title, typeof patch.title === 'string' ? { text: patch.title } : patch.title);
                for (const key of keys.filter(key => key !== 'title')) setPath(title, key.slice(6), normalizeValue(patch[key]));
                update[index ? 'alternateTitle' : 'title'] = title;
                update[index ? 'alternateHeader' : 'header'] = headerFromTitle(title, layout, mobile);
                for (const key of keys) delete patch[key];
            }
            if (!update.header && !update.alternateHeader) return;
            if (!button.name) button.name = 'responsive-title-' + menuIndex + ':' + buttonIndex;
            update.name = button.name;
            updates.push(update);
        }));
        return updates;
    }

    function fitFigure(figure, measuredWidth, options = {}) {
        const width = Math.max(1, Math.floor(number(measuredWidth, 360)));
        const mobile = width < MOBILE_WIDTH;
        const externalTitle = options.titlePlacement !== 'internal';
        const data = normalizeValue(Array.isArray(figure.data) ? figure.data : []);
        const sourceLayout = figure.layout || {};
        const layout = normalizeValue(sourceLayout);
        const config = Object.assign({}, figure.config || {}, { responsive: true });
        const warnings = [];
        const yearMenus = repairYearMenu(data, layout, options, warnings, figure.frames);
        delete layout.width;
        layout.autosize = true;
        if (layout.uirevision === undefined) layout.uirevision = 'responsive-layout';
        for (const trace of data) repairHierarchy(trace, warnings);
        const panels = panelsFor(data, layout);
        const sourceMargin = sourceLayout.margin || {};
        const dualRight = Object.entries(layout).some(([key, axis]) => /^yaxis\d*$/.test(key) && axis.side === 'right');
        const margin = layout.margin = Object.assign({}, sourceMargin, {
            l: mobile ? Math.min(number(sourceMargin.l, 54), Math.floor(width * 0.24)) : number(sourceMargin.l, 60),
            r: mobile ? Math.min(dualRight ? Math.max(number(sourceMargin.r, 20), 52) : number(sourceMargin.r, 20), Math.floor(width * 0.2)) : number(sourceMargin.r, 30),
            t: number(sourceMargin.t, 70), b: number(sourceMargin.b, 50)
        });
        let plotWidth = Math.max(40, width - margin.l - margin.r);
        const annotationNotes = mobile ? compactEndpointAnnotations(data, layout, plotWidth, warnings) : [];
        // Release only the displaced callouts' gutter. Polar names, right axes,
        // and other authored margins still need their existing space.
        if (annotationNotes.length && !dualRight && panels.every(panel => panel.kind === 'cartesian')) {
            margin.r = Math.min(margin.r, 24);
            plotWidth = Math.max(40, width - margin.l - margin.r);
        }
        protectDataAnnotations(layout, plotWidth, mobile, warnings);
        const title = typeof layout.title === 'string' ? { text: layout.title } : layout.title || {};
        const header = externalTitle ? headerFromTitle(title, layout, mobile) : null;
        const titleSize = mobile ? Math.min(number(title.font && title.font.size, 16), 16) : number(title.font && title.font.size, 18);
        const wrappedTitle = wrapText(title.text, titleSize, Math.max(40, width - 28));
        // Native menu clicks do not refit the figure; reserve the longest title up front.
        const titleLines = externalTitle ? 0 : Math.max(wrappedTitle.lines, ...yearMenus.flatMap(item =>
            layout.updatemenus[item.menuIndex].buttons.map(button => {
                const value = button.args[1].title;
                return wrapText(typeof value === 'string' ? value : value && value.text, titleSize, Math.max(40, width - 28)).lines;
            })));
        const titleUpdates = externalTitle ? extractTitleUpdates(layout, mobile) : [];
        if (externalTitle) layout.title = { text: '' };
        if (title.text && !externalTitle) {
            title.text = wrappedTitle.text;
            title.font = Object.assign({}, title.font, { size: titleSize });
            // We reserve the multiline title region ourselves on mobile. Plotly's
            // title automargin fallback can shift all tspans above the SVG edge.
            title.automargin = !mobile;
            if (mobile) Object.assign(title, { xref: 'container', yref: 'container', x: 0.025, y: 0.99, xanchor: 'left', yanchor: 'top', pad: { t: 0 } });
            layout.title = title;
        }
        let stacked = false;
        if (mobile) {
            stacked = stackPanels(data, layout, panels, plotWidth);
            fitAxes(data, layout, panels, plotWidth, warnings);
            config.displayModeBar = false;
            layout.font = Object.assign({}, layout.font, { size: Math.min(number(layout.font && layout.font.size, 12), 12) });
            layout.uniformtext = Object.assign({}, layout.uniformtext, { minsize: 10, mode: 'hide' });
            for (const trace of data) {
                if (trace.type === 'pie') {
                    trace.textposition = 'inside';
                    if (layout.showlegend !== false && trace.showlegend !== false) {
                        trace.textinfo = 'percent';
                        trace.texttemplate = '%{percent}';
                    }
                    trace.automargin = true;
                    trace.insidetextfont = Object.assign({}, trace.insidetextfont, { size: 11 });
                }
                if (trace.type === 'bar') {
                    trace.textfont = Object.assign({}, trace.textfont, { size: Math.min(number(trace.textfont && trace.textfont.size, 11), 11) });
                    trace.cliponaxis = false;
                }
                if (trace.type === 'scatter' || trace.type === 'scatterpolar') trace.cliponaxis = false;
                if (trace.type === 'heatmap' && typeof trace.texttemplate === 'string') {
                    const columnCount = Array.isArray(trace.z && trace.z[0]) ? trace.z[0].length : 1;
                    // Axis names are already shown on the axes; retain the numeric
                    // template and unit when repeated axis labels crowd narrow cells.
                    if (plotWidth / columnCount < 120) {
                        const compact = trace.texttemplate.split(/<br\s*\/?>/i).filter(line => !/%\{[xy](?:[:}]|\|)/.test(line)).join('<br>');
                        if (compact.includes('%{z')) trace.texttemplate = compact;
                    }
                    trace.textfont = Object.assign({}, trace.textfont, { size: Math.min(number(trace.textfont && trace.textfont.size, 11), 11) });
                }
                if (trace.type === 'sankey' && trace.node && Array.isArray(trace.node.label)) {
                    const limit = width < 360 ? 5 : width < 440 ? 6 : 8;
                    if (!trace.node.customdata && !trace.node.hovertemplate && trace.node.label.some(label => Array.from(String(label)).length > limit)) {
                        trace.node.customdata = trace.node.label.slice();
                        trace.node.hovertemplate = '%{customdata}<br>%{value}<extra></extra>';
                        trace.node.label = trace.node.label.map(label => {
                            const chars = Array.from(String(label));
                            return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : label;
                        });
                    }
                    trace.node.pad = Math.min(number(trace.node.pad, 12), 14);
                    trace.node.thickness = Math.min(number(trace.node.thickness, 16), 18);
                }
            }
        }
        let topLines = 0;
        const footers = [];
        if (mobile) {
            for (const annotation of layout.annotations || []) {
                if (annotation.showarrow !== false || annotation.xref !== 'paper' || annotation.yref !== 'paper') continue;
                annotation.font = Object.assign({}, annotation.font, { size: Math.min(number(annotation.font && annotation.font.size, 14), 14) });
                const wrapped = wrapText(annotation.text, annotation.font.size, plotWidth - 12);
                annotation.text = wrapped.text;
                if (Number(annotation.y) < 0) {
                    footers.push({ annotation, height: wrapped.lines * (annotation.font.size + 4) + 8 });
                } else if (panels.some(panel => Math.abs(annotation.y - panel.domain.y[1]) < 0.006 &&
                    annotation.x >= panel.domain.x[0] && annotation.x <= panel.domain.x[1])) {
                    annotation.yanchor = 'bottom';
                    annotation.yshift = 4;
                    if (annotation.y > 0.98) topLines = Math.max(topLines, wrapped.lines);
                }
            }
            margin.t = Math.max(Math.ceil(32 + titleLines * titleSize * 1.3 + topLines * 18 + (topLines ? 14 : 0)), Math.min(margin.t, 150));
        }
        const legendFontSize = mobile ? 11 : number(layout.legend && layout.legend.font && layout.legend.font.size, 12);
        const legend = mobile || externalTitle ? legendMetrics(data, layout, mobile ? width - margin.r - 12 : plotWidth, legendFontSize, mobile) : { height: 0, rows: 0 };
        const titleBudget = titleLines * titleSize * 1.3;
        // A short internal title can share the top with a small legend. Crowded
        // internal headers use the bottom; wide authored legends keep their layout.
        const legendPlacement = !legend.height ? 'preserve' : !externalTitle && mobile &&
            (titleLines > 1 || titleBudget + legend.height + topLines * 18 > Math.min(150, number(sourceLayout.height, 520) * 0.3)) ? 'bottom' : 'top';
        const bottomLegendHeight = legendPlacement === 'bottom' ? legend.height : 0;
        if (externalTitle || mobile && legendPlacement === 'top') {
            if (!mobile) topLines = Math.max(0, ...(layout.annotations || []).filter(a => a.visible !== false && a.showarrow === false &&
                a.xref === 'paper' && a.yref === 'paper' && a.y >= 0.98).map(a =>
                wrapText(a.text, number(a.font && a.font.size, 14), plotWidth).lines + Math.max(0, a.y - 1) * 20));
            margin.t = Math.ceil(32 + titleBudget + topLines * 18 + (topLines ? 14 : 0) + (legendPlacement === 'top' ? legend.height : 0));
        }
        const colorbars = mobile ? colorbarBands(data, layout, plotWidth) : [];
        const colorbarHeight = colorbars.reduce((sum, item) => sum + item.height, 0);
        const bottomPanels = panels.filter(panel => panel.domain.y[0] < 0.001);
        const hasBottomAxis = bottomPanels.some(panel => panel.kind === 'cartesian');
        const bottomTitle = bottomPanels.some(panel => panel.xaxes.some(ref => layout[axisKey(ref)].title && layout[axisKey(ref)].title.text));
        const axisFoot = hasBottomAxis
            ? Math.max(bottomTitle ? 72 : 52, ...bottomPanels.map(panel => axisFootPixels(panel, layout))) : 12;
        const footerHeight = footers.reduce((sum, item) => sum + item.height, 0);
        const menus = (layout.updatemenus || []).filter(menu => menu.visible !== false);
        const sliders = mobile ? (layout.sliders || []).filter(slider => slider.visible !== false) : [];
        const controlsHeight = mobile ? menus.length * 42 + sliders.length * 68 : 0;
        if (mobile) margin.b = Math.max(margin.b, axisFoot + bottomLegendHeight + colorbarHeight + footerHeight + controlsHeight + 12);
        const baseHeight = number(sourceLayout.height, 520);
        const height = Math.max(400, mobile || externalTitle ? Math.max(baseHeight, margin.t + margin.b + minimumPlotHeight(panels, layout)) : baseHeight);
        const plotHeight = height - margin.t - margin.b;
        if (!externalTitle && title.text && !mobile && title.y === undefined && title.yref !== 'paper' &&
            (!title.yanchor || title.yanchor === 'auto' || title.yanchor === 'top')) {
            Object.assign(title, { yref: 'container', yanchor: 'top', y: 1 });
        }
        // Plotly's multiline tspans use y as a baseline, unlike single-line titles.
        // Keep that baseline below the SVG edge in pixels, independent of chart height.
        if (!externalTitle && title.text && (mobile || title.yanchor === 'top' && title.yref !== 'paper' && number(title.y, 1) >= 0.9)) {
            title.yref = 'container';
            title.y = Math.min(number(title.y, 1), 1 - (titleSize + 8) / height);
        }
        if (legend.height) {
            layout.legend = Object.assign({}, layout.legend, {
                orientation: 'h', xref: 'paper', yref: 'paper', x: 0, xanchor: 'left',
                y: legendPlacement === 'top' ? 1 + (16 + topLines * 18) / plotHeight : -axisFoot / plotHeight,
                yanchor: legendPlacement === 'top' ? 'bottom' : 'top', itemwidth: 30,
                font: Object.assign({}, layout.legend && layout.legend.font, { size: legendFontSize }),
                tracegroupgap: 0
            });
            if (mobile) {
                // Horizontal legends still use plot width with xref=container, and
                // can push the left margin. A paper anchor above the left gutter
                // lets native Plotly include that free space in its width budget.
                layout.legend.x = Math.min(0, (12 - margin.l) / plotWidth);
                if (legend.columns) Object.assign(layout.legend, { entrywidth: 1 / legend.columns, entrywidthmode: 'fraction' });
            }
        }
        let colorbarOffset = axisFoot + bottomLegendHeight + 8;
        for (const item of colorbars) {
            item.bar.y = -colorbarOffset / plotHeight;
            colorbarOffset += item.height;
        }
        let footerOffset = axisFoot + bottomLegendHeight + colorbarHeight + 8;
        for (const item of footers) {
            Object.assign(item.annotation, { y: 0, yanchor: 'top', yshift: -footerOffset });
            footerOffset += item.height;
        }
        let controlOffset = axisFoot + bottomLegendHeight + colorbarHeight + footerHeight + 8;
        for (const menu of menus) {
            for (const button of menu.buttons || []) {
                if (!button.label) {
                    const argsTitle = button.args && button.args[1] && button.args[1].title;
                    const text = typeof argsTitle === 'string' ? argsTitle : argsTitle && argsTitle.text;
                    const year = text && text.match(/(?:（|\()(\d{4})(?:，|,|）|\))/);
                    button.label = year ? year[1] : '选项 ' + ((menu.buttons || []).indexOf(button) + 1);
                    warnings.push('补齐按钮显示标签；按钮原有数据更新参数保留。');
                }
                if (button.args && button.args[1] && button.args[1].title) {
                    const original = button.args[1].title;
                    const updateTitle = typeof original === 'string' ? { text: original } : original;
                    button.args[1].title = Object.assign({}, title, updateTitle, { text: wrapText(updateTitle.text, titleSize, width - 28).text });
                    if (mobile) {
                        for (const key of ['xref', 'yref', 'x', 'y', 'xanchor', 'yanchor', 'pad', 'automargin', 'font']) {
                            button.args[1].title[key] = normalizeValue(title[key]);
                        }
                    } else if (button.args[1].title.yanchor === 'top' && button.args[1].title.yref !== 'paper' &&
                        number(button.args[1].title.y, 1) >= 0.9) {
                        button.args[1].title.y = Math.min(number(button.args[1].title.y, 1), 1 - (titleSize + 8) / height);
                    }
                }
            }
            if (!mobile) continue;
            const buttonWidth = (menu.buttons || []).reduce((sum, button) => sum + textWidth(String(button.label), 11) + 28, 0);
            if (menu.type === 'buttons' && buttonWidth > plotWidth) menu.type = 'dropdown';
            Object.assign(menu, { x: 0, xanchor: 'left', y: -controlOffset / plotHeight, yanchor: 'top', direction: menu.type === 'dropdown' ? 'up' : 'right' });
            menu.font = Object.assign({}, menu.font, { size: 11 });
            controlOffset += 42;
        }
        for (const slider of sliders) {
            Object.assign(slider, { x: 0, len: 1, y: -controlOffset / plotHeight, yanchor: 'top' });
            controlOffset += 68;
        }
        layout.height = height;
        return { data, layout, config, height, header, titleUpdates, legendPlacement, annotationNotes, panels, stacked, yearMenus, warnings: [...new Set(warnings)] };
    }

    function overlaps(a, b) {
        return a.left < b.right + 1 && a.right + 1 > b.left && a.top < b.bottom + 1 && a.bottom + 1 > b.top;
    }

    // measure must use the rendered font; cell area alone cannot establish readability.
    function fitCellText(value, width, height, measure, options = {}) {
        const fontSize = Math.max(10, number(options.fontSize, 10));
        const padding = number(options.padding, 2);
        const lineHeight = fontSize * 1.2;
        const result = { lines: [], status: 'hidden', fontSize, padding, lineHeight };
        const innerWidth = width - padding * 2;
        const maxLines = Math.floor((height - padding * 2) / lineHeight + 0.00001);
        if (width < number(options.minWidth, 24) || height < number(options.minHeight, 18) ||
            !maxLines || innerWidth <= 0 || typeof measure !== 'function' || !value) return result;
        const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
        const graphemes = text => segmenter ? Array.from(segmenter.segment(text), item => item.segment) : Array.from(text);
        const lines = [];
        for (const paragraph of String(value).split(/\r?\n/)) {
            let chars = graphemes(paragraph.trim());
            if (!chars.length) { lines.push(''); continue; }
            while (chars.length) {
                let count = 0;
                while (count < chars.length && measure(chars.slice(0, count + 1).join('')) <= innerWidth + 0.001) count++;
                if (!count) return result;
                if (count < chars.length && !/\s/.test(chars[count])) {
                    const space = chars.slice(0, count).lastIndexOf(' ');
                    if (space > 0) count = space;
                }
                lines.push(chars.splice(0, count).join('').trimEnd());
                while (chars.length && /\s/.test(chars[0])) chars.shift();
            }
        }
        if (lines.length <= maxLines) return Object.assign(result, { lines, status: lines.length > 1 ? 'wrapped' : 'full' });
        const kept = lines.slice(0, maxLines);
        const tail = graphemes(kept[maxLines - 1]);
        while (tail.length && measure(tail.join('') + '…') > innerWidth + 0.001) tail.pop();
        if (measure(tail.join('') + '…') > innerWidth + 0.001 || !tail.length && kept.length === 1) return result;
        kept[maxLines - 1] = tail.join('').trimEnd() + '…';
        return Object.assign(result, { lines: kept, status: 'ellipsis' });
    }

    function fitTreemapLabels(gd) {
        if (!gd.ownerDocument || !gd.ownerDocument.createElementNS) return;
        const entries = Array.from(gd.querySelectorAll('.treemaplayer .slice')).map(slice => {
            const surface = slice.querySelector('path.surface');
            const text = slice.querySelector('text.slicetext');
            return surface ? { slice, surface, text, rect: surface.getBoundingClientRect() } : null;
        }).filter(Boolean);
        for (const entry of entries) {
            const { surface, text, rect, slice } = entry;
            if (!text) continue;
            const source = text.getAttribute('data-unformatted');
            // Preserve rich formatting/math and explicitly disabled labels. Never change
            // labels/ids/hovertemplate: the SVG display is regenerated from its complete text.
            if (!source || /<(?!(?:br\s*\/?>))[^>]*>|\$/.test(source)) continue;
            const box = surface.getBBox();
            if (!box.width || !box.height || !rect.width || !rect.height) continue;
            const scaleX = rect.width / box.width, scaleY = rect.height / box.height;
            const children = entries.filter(other => other !== entry && other.slice.parentElement === slice.parentElement &&
                other.rect.left >= rect.left - 0.1 && other.rect.right <= rect.right + 0.1 &&
                other.rect.top > rect.top + 1 && other.rect.bottom <= rect.bottom + 0.1);
            // Branch labels belong to their header strip, never to the children's area.
            const availableHeight = children.length ? Math.min(...children.map(child => child.rect.top - rect.top)) - 1 : rect.height;
            text.setAttribute('data-responsive-height', String(availableHeight));
            const view = gd.ownerDocument.defaultView;
            const preferred = Math.max(10, parseFloat(view.getComputedStyle(text).fontSize) * scaleY || 12);
            const probe = text.cloneNode(false);
            probe.removeAttribute('transform');
            probe.style.display = '';
            probe.style.visibility = 'hidden';
            text.parentElement.appendChild(probe);
            let fitted;
            for (const fontSize of [...new Set([preferred, 10])]) {
                probe.style.fontSize = fontSize / scaleY + 'px';
                const measure = value => { probe.textContent = value; return probe.getComputedTextLength() * scaleX; };
                fitted = fitCellText(plainText(source), rect.width, availableHeight, measure, { fontSize });
                if (fitted.status === 'full' || fitted.status === 'wrapped') break;
            }
            probe.remove();
            text.setAttribute('data-responsive-label', fitted.status);
            if (fitted.status === 'hidden') { text.style.display = 'none'; continue; }
            const oldTransform = text.getAttribute('transform') || '';
            if (oldTransform !== text.getAttribute('data-responsive-transform')) {
                const match = oldTransform.match(/translate\([^,\s]+[,\s]+([^\s,)]+)/);
                const relativeY = match ? (Number(match[1]) - box.y) / box.height : 0;
                text.setAttribute('data-responsive-valign', relativeY > 0.75 ? 'bottom' : relativeY > 0.3 ? 'middle' : 'top');
            }
            const anchor = text.getAttribute('text-anchor');
            const x = anchor === 'middle' ? box.x + box.width / 2 : anchor === 'end' ? box.x + box.width - fitted.padding / scaleX : box.x + fitted.padding / scaleX;
            const blockHeight = fitted.lines.length * fitted.lineHeight;
            const valign = children.length ? 'top' : text.getAttribute('data-responsive-valign');
            const offsetY = valign === 'bottom' ? availableHeight - blockHeight - fitted.padding : valign === 'middle' ? (availableHeight - blockHeight) / 2 : fitted.padding;
            text.style.display = '';
            text.style.fontSize = fitted.fontSize / scaleY + 'px';
            text.replaceChildren();
            for (const [index, line] of fitted.lines.entries()) {
                const span = gd.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                span.setAttribute('x', '0');
                span.setAttribute('y', String(index * fitted.lineHeight / scaleY));
                span.textContent = line;
                text.appendChild(span);
            }
            text.removeAttribute('transform');
            const glyphs = text.getBBox();
            const transform = 'translate(' + x + ',' + (box.y + offsetY / scaleY - glyphs.y) + ')';
            text.setAttribute('transform', transform);
            text.setAttribute('data-responsive-transform', transform);
            const actual = text.getBoundingClientRect();
            if (actual.left < rect.left + 0.5 || actual.right > rect.right - 0.5 ||
                actual.top < rect.top + 0.5 || actual.bottom > rect.top + availableHeight - 0.5) {
                text.style.display = 'none';
                text.setAttribute('data-responsive-label', 'hidden');
            }
        }
    }

    function resolveTextCollisions(gd) {
        if (!gd || typeof gd.querySelectorAll !== 'function') return 0;
        fitTreemapLabels(gd);
        const bounds = gd.getBoundingClientRect();
        const obstacles = Array.from(gd.querySelectorAll('.gtitle, .annotation-text, .annotation rect.bg, g[class$="tick"] text, g[class^="g-"][class$="title"] text'))
            .map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
        const accepted = [];
        let hidden = 0;
        const labels = gd.querySelectorAll('.scatterlayer .textpoint, .scatterpolarlayer .textpoint, .polarlayer .textpoint, .barlayer .bartext');
        for (const node of labels) {
            if (!labelVisibility.has(node)) labelVisibility.set(node, node.style.visibility || '');
            node.style.visibility = labelVisibility.get(node);
            if (node.style.visibility === 'hidden') continue;
            const rect = node.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            const outside = rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom;
            if (outside || obstacles.some(other => overlaps(rect, other)) || accepted.some(other => overlaps(rect, other))) {
                node.style.visibility = 'hidden';
                hidden++;
            } else accepted.push(rect);
        }
        return hidden;
    }

    return { fitFigure, renderHeader, wrapText, normalizeValue, resolveTextCollisions, fitCellText, fitTreemapLabels };
});
