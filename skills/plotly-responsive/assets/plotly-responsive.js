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
        const known = new Set(ids.map(String));
        const missing = [...new Set(trace.parents.filter(parent => parent !== '' && parent !== null).map(String))]
            .filter(parent => !known.has(parent));
        if (!missing.length) return;
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
        warnings.push('补齐层级图缺失父节点：' + missing.join('、') + '；total 父值由现有子节点求和。');
    }

    function fitAxes(data, layout, panels, plotWidth) {
        for (const [key, axis] of Object.entries(layout)) {
            if (!/^[xy]axis\d*$/.test(key) || !axis) continue;
            axis.automargin = true;
            axis.tickfont = Object.assign({}, axis.tickfont, { size: Math.min(number(axis.tickfont && axis.tickfont.size, 10), 10) });
            if (axis.title) {
                axis.title = typeof axis.title === 'string' ? { text: axis.title } : axis.title;
                axis.title.font = Object.assign({}, axis.title.font, { size: Math.min(number(axis.title.font && axis.title.font.size, 11), 11) });
                if (key[0] === 'y') axis.title.text = wrapText(axis.title.text, 11, 190).text;
                axis.title.standoff = Math.min(number(axis.title.standoff, 10), 10);
            }
            if (key[0] !== 'x' || axis.tickvals || axis.showticklabels === false) continue;
            const ref = key[0] + key.slice(5);
            const values = data.filter(t => (t.xaxis || 'x') === ref).flatMap(t => Array.isArray(t.x) ? t.x : []);
            const categories = [...new Set(values.filter(value => typeof value === 'string'))];
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
                axis.ticktext = picked.map(value => wrapText(value, 10, plotWidth / picked.length - 6).text);
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
                }
            }
        }
    }

    function legendMetrics(data, layout, availableWidth) {
        if (layout.showlegend === false || (layout.legend && layout.legend.visible === false)) return { height: 0, rows: 0 };
        const entries = [];
        for (const [i, trace] of data.entries()) {
            if (trace.showlegend === false || trace.visible === false) continue;
            if (['pie', 'funnelarea'].includes(trace.type) && Array.isArray(trace.labels)) {
                const originalLabels = trace.labels.slice();
                trace.labels = trace.labels.map(label => wrapText(String(label), 11, Math.max(70, availableWidth - 54)).text);
                entries.push(...trace.labels);
                if (!trace.hovertemplate && !trace.hovertext) {
                    trace.hovertext = originalLabels;
                    trace.hovertemplate = '%{hovertext}<br>%{value}<br>%{percent}<extra></extra>';
                }
            } else if (!DOMAIN_TYPES.has(trace.type) && (trace.name || trace.showlegend === true || data.length > 1)) {
                trace.name = wrapText(String(trace.name || 'trace ' + i), 11, Math.max(70, availableWidth - 54)).text;
                entries.push(trace.name);
            }
        }
        if (!entries.length) return { height: 0, rows: 0 };
        let used = 0;
        let rowHeight = 0;
        let height = 0;
        let rows = 1;
        for (const text of entries) {
            const lines = plainText(text).split('\n');
            const itemWidth = Math.min(availableWidth, Math.max(...lines.map(line => textWidth(line, 11))) + 54);
            const itemHeight = lines.length * 16 + 8;
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
            const upperTicks = upper.xaxes.some(ref => layout[axisKey(ref)].showticklabels !== false) ? 42 : 8;
            pixels = Math.max(pixels, Math.ceil((upperTicks + headingLines * 18 + 10) / gap));
        }
        return pixels;
    }

    function fitFigure(figure, measuredWidth) {
        const width = Math.max(1, Math.floor(number(measuredWidth, 360)));
        const mobile = width < MOBILE_WIDTH;
        const data = normalizeValue(Array.isArray(figure.data) ? figure.data : []);
        const sourceLayout = figure.layout || {};
        const layout = normalizeValue(sourceLayout);
        const config = Object.assign({}, figure.config || {}, { responsive: true });
        const warnings = [];
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
        const plotWidth = Math.max(40, width - margin.l - margin.r);
        const title = typeof layout.title === 'string' ? { text: layout.title } : layout.title || {};
        const titleSize = mobile ? Math.min(number(title.font && title.font.size, 16), 16) : number(title.font && title.font.size, 18);
        const wrappedTitle = wrapText(title.text, titleSize, Math.max(40, width - 28));
        if (title.text) {
            title.text = wrappedTitle.text;
            title.font = Object.assign({}, title.font, { size: titleSize });
            title.automargin = true;
            if (mobile) Object.assign(title, { xref: 'container', yref: 'container', x: 0.025, y: 0.99, xanchor: 'left', yanchor: 'top', pad: { t: 0 } });
            layout.title = title;
        }
        let stacked = false;
        if (mobile) {
            stacked = stackPanels(data, layout, panels, plotWidth);
            fitAxes(data, layout, panels, plotWidth);
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
            margin.t = Math.max(16 + wrappedTitle.lines * (titleSize + 5) + topLines * 18 + (topLines ? 14 : 0), Math.min(margin.t, 150));
        }
        const legend = mobile ? legendMetrics(data, layout, plotWidth) : { height: 0, rows: 0 };
        const bottomPanels = panels.filter(panel => panel.domain.y[0] < 0.001);
        const hasBottomAxis = bottomPanels.some(panel => panel.kind === 'cartesian');
        const bottomTitle = bottomPanels.some(panel => panel.xaxes.some(ref => layout[axisKey(ref)].title && layout[axisKey(ref)].title.text));
        const axisFoot = hasBottomAxis ? bottomTitle ? 72 : 52 : 12;
        const footerHeight = footers.reduce((sum, item) => sum + item.height, 0);
        const menus = mobile ? (layout.updatemenus || []).filter(menu => menu.visible !== false) : [];
        const sliders = mobile ? (layout.sliders || []).filter(slider => slider.visible !== false) : [];
        const controlsHeight = menus.length * 42 + sliders.length * 68;
        if (mobile) margin.b = Math.max(margin.b, axisFoot + legend.height + footerHeight + controlsHeight + 12);
        const baseHeight = number(sourceLayout.height, 520);
        const height = Math.max(400, mobile ? Math.max(baseHeight, margin.t + margin.b + minimumPlotHeight(panels, layout)) : baseHeight);
        const plotHeight = height - margin.t - margin.b;
        if (mobile && legend.height) {
            layout.legend = Object.assign({}, layout.legend, {
                orientation: 'h', xref: 'paper', yref: 'paper', x: 0, xanchor: 'left',
                y: -axisFoot / plotHeight, yanchor: 'top', itemwidth: 30,
                font: Object.assign({}, layout.legend && layout.legend.font, { size: 11 }),
                tracegroupgap: 0
            });
        }
        let footerOffset = axisFoot + legend.height + 8;
        for (const item of footers) {
            Object.assign(item.annotation, { y: 0, yanchor: 'top', yshift: -footerOffset });
            footerOffset += item.height;
        }
        let controlOffset = axisFoot + legend.height + footerHeight + 8;
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
                }
            }
            const buttonWidth = (menu.buttons || []).reduce((sum, button) => sum + textWidth(String(button.label), 11) + 28, 0);
            if (menu.type === 'buttons' && buttonWidth > plotWidth) menu.type = 'dropdown';
            Object.assign(menu, { x: 0, xanchor: 'left', y: -controlOffset / plotHeight, yanchor: 'top', direction: menu.type === 'dropdown' ? 'down' : 'right' });
            menu.font = Object.assign({}, menu.font, { size: 11 });
            controlOffset += 42;
        }
        for (const slider of sliders) {
            Object.assign(slider, { x: 0, len: 1, y: -controlOffset / plotHeight, yanchor: 'top' });
            controlOffset += 68;
        }
        layout.height = height;
        return { data, layout, config, height, panels, stacked, warnings: [...new Set(warnings)] };
    }

    function overlaps(a, b) {
        return a.left < b.right + 1 && a.right + 1 > b.left && a.top < b.bottom + 1 && a.bottom + 1 > b.top;
    }

    function resolveTextCollisions(gd) {
        if (!gd || typeof gd.querySelectorAll !== 'function') return 0;
        const bounds = gd.getBoundingClientRect();
        const obstacles = Array.from(gd.querySelectorAll('.gtitle, .annotation-text, g[class$="tick"] text, g[class^="g-"][class$="title"] text'))
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

    return { fitFigure, wrapText, normalizeValue, resolveTextCollisions };
});
