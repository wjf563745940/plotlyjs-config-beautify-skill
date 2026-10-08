const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { fitFigure, wrapText, normalizeValue, resolveTextCollisions } = require('../skills/plotly-responsive/assets/plotly-responsive');

const mockRoot = path.join(__dirname, '..', 'mocks');
const fixtureNames = fs.readdirSync(mockRoot)
    .filter(file => /^mock\d+(?:_[a-z0-9-]+)*\.js$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(file => file.slice(0, -3));

function fixture(name) {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(mockRoot, name + '.js'), 'utf8'), context, { timeout: 3000 });
    assert.ok(context.window.mockData !== undefined, name + ' must assign window.mockData');
    const value = JSON.parse(JSON.stringify(context.window.mockData));
    return Array.isArray(value) ? value : [value];
}

for (const name of fixtureNames) {
    test(name + ': all figures fit geometry at 360, 420 and 520px', () => {
        const charts = fixture(name);
        const original = JSON.stringify(charts);
        for (const viewport of [360, 420, 520]) {
            const chartWidth = viewport - 34; // mobile body and card padding in index.html
            for (const chart of charts) {
                const result = fitFigure(chart, chartWidth);
                assert.equal(result.layout.width, undefined);
                assert.equal(result.config.responsive, true);
                assert.equal(result.config.displayModeBar, false);
                assert.ok(result.layout.margin.l + result.layout.margin.r < chartWidth * 0.5);
                assert.ok(Number.isFinite(result.height) && result.height >= 400);
                const plotHeight = result.height - result.layout.margin.t - result.layout.margin.b;
                for (const panel of result.panels) {
                    const span = panel.domain.y[1] - panel.domain.y[0];
                    const minimum = panel.kind === 'cartesian' ? 160 : panel.kind === 'polar' ? 240 : 260;
                    assert.ok(span * plotHeight + 0.001 >= minimum, name + ': minimum panel height');
                    assert.ok(panel.domain.y[0] >= 0 && panel.domain.y[1] <= 1);
                    if (result.stacked) assert.deepEqual(panel.domain.x, [0, 1]);
                }
                if (result.stacked) {
                    for (let i = 1; i < result.panels.length; i++) {
                        assert.ok(result.panels[i].domain.y[1] < result.panels[i - 1].domain.y[0], 'stacked panels must not overlap');
                    }
                }
                const normalized = normalizeValue(chart.data);
                result.data.forEach((trace, i) => {
                    for (const key of ['x', 'y', 'z', 'r', 'theta', 'open', 'high', 'low', 'close']) {
                        if (normalized[i][key] !== undefined) assert.deepEqual(trace[key], normalized[i][key], 'preserve source values');
                    }
                    for (const key of ['xaxis', 'yaxis', 'subplot', 'scene', 'geo']) {
                        assert.equal(trace[key], normalized[i][key], 'preserve trace references');
                    }
                });
                if (result.layout.legend && chart.layout.showlegend !== false) {
                    const legendStart = -result.layout.legend.y * plotHeight;
                    assert.ok(legendStart >= 0 && legendStart < result.layout.margin.b);
                }
            }
        }
        assert.equal(JSON.stringify(charts), original, 'fitting must not mutate the fixture');
    });
}

test('rich titles keep markup and text while wrapping long subtitle lines', () => {
    const chart = fixture('mock11_notresolve')[0];
    const result = fitFigure(chart, 326);
    const originalTitle = chart.layout.title.text;
    assert.ok(result.layout.title.text.includes('<sup>'));
    assert.ok(result.layout.title.text.includes('</sup>'));
    const unbroken = text => text.replace(/<br\s*\/?>|\s/gi, '');
    assert.equal(unbroken(result.layout.title.text), unbroken(originalTitle));
    assert.ok(result.layout.title.text.split('<br>').length > originalTitle.split('<br>').length);
    const sample = wrapText('<b>A&amp;B以及很长的中文标题</b>', 16, 70);
    assert.equal(unbroken(sample.text), '<b>A&amp;B以及很长的中文标题</b>');
});

test('side-by-side Cartesian headings move with their panels', () => {
    const chart = fixture('mock3_point')[0];
    const fitted = fitFigure(chart, 326);
    assert.equal(fitted.stacked, true);
    assert.ok(fitted.layout.annotations[0].y > fitted.layout.annotations[1].y);
    fitted.layout.annotations.forEach((annotation, i) => {
        assert.ok(Math.abs(annotation.x - 0.5) < 0.0001);
        assert.ok(Math.abs(annotation.y - fitted.panels[i].domain.y[1]) < 0.0001);
    });
    const wide = fitFigure(chart, 900);
    assert.equal(wide.stacked, false);
    assert.deepEqual(wide.layout.xaxis2.domain, chart.layout.xaxis2.domain);
});

test('mixed grid keeps secondary axes and gives the pie its own stacked domain', () => {
    const chart = fixture('mock8_point')[0];
    const fitted = fitFigure(chart, 326);
    assert.equal(fitted.panels.length, 6);
    assert.equal(fitted.layout.yaxis2.overlaying, 'y');
    assert.equal(fitted.layout.yaxis4.overlaying, 'y3');
    assert.equal(fitted.layout.yaxis8.overlaying, 'y7');
    const pieIndex = chart.data.findIndex(trace => trace.type === 'pie');
    const piePanel = fitted.panels.find(panel => panel.traces.includes(pieIndex));
    assert.deepEqual(fitted.data[pieIndex].domain, piePanel.domain);
    assert.equal(fitted.data[pieIndex].textposition, 'inside');
    assert.equal(fitted.data[pieIndex].texttemplate, '%{percent}');
});

test('Cartesian and polar panels stack independently', () => {
    const chart = fixture('mock16_point')[0];
    const result = fitFigure(chart, 386);
    assert.equal(result.stacked, true);
    assert.ok(result.layout.polar.domain.y[1] < result.layout.yaxis.domain[0]);
    assert.equal(result.data[2].subplot, 'polar');
});

test('pie legend items reserve space even without a trace name', () => {
    const chart = fixture('mock5_point')[0];
    const result = fitFigure(chart, 326);
    assert.ok(result.layout.legend.y < 0);
    assert.ok(result.layout.margin.b > chart.layout.margin.b);
    assert.deepEqual(result.data[0].hovertext, chart.data[0].labels);
});

test('missing hierarchy parents are derived without changing leaf values', () => {
    const chart = fixture('mock12_dirty')[1];
    const result = fitFigure(chart, 326);
    const trace = result.data[0];
    const normalized = normalizeValue(chart.data[0]);
    assert.deepEqual(trace.labels.slice(0, normalized.labels.length), normalized.labels);
    assert.deepEqual(trace.values.slice(0, normalized.values.length), normalized.values);
    const known = new Set((trace.ids || trace.labels).map(String));
    assert.ok(trace.parents.every(parent => parent === '' || known.has(String(parent))));
    for (const parent of ['X', 'Y']) {
        const index = trace.labels.indexOf(parent);
        const expected = normalized.parents.reduce((sum, key, i) => sum + (key === parent ? normalized.values[i] : 0), 0);
        assert.equal(trace.values[index], expected);
    }
    assert.ok(result.warnings.length > 0);
    assert.equal(fitFigure(fixture('mock12_dirty')[3], 326).warnings.length, 0);
});

test('footer annotations and menu controls occupy separate bottom bands', () => {
    const tree = fitFigure(fixture('mock12_dirty')[0], 326);
    assert.equal(tree.layout.annotations[0].yanchor, 'top');
    assert.ok(tree.layout.annotations[0].yshift < 0);
    const bubble = fitFigure(fixture('mock11_notresolve')[0], 326);
    const menu = bubble.layout.updatemenus[0];
    assert.deepEqual(menu.buttons.map(button => button.label), ['2021', '2022', '2023', '2024', '2025']);
    assert.ok(menu.y < bubble.layout.legend.y);
    assert.equal(menu.type, 'dropdown');
    assert.equal(menu.buttons[0].method, 'update');
    assert.deepEqual(menu.buttons[0].args[0].visible, [true, true, true]);
});

test('resize restores full Sankey labels and authored desktop layout', () => {
    const chart = fixture('mock1')[0];
    const narrow = fitFigure(chart, 326);
    const wide = fitFigure(chart, 900);
    assert.deepEqual(narrow.data[0].node.customdata, chart.data[0].node.label);
    assert.notDeepEqual(narrow.data[0].node.label, wide.data[0].node.label);
    assert.deepEqual(wide.data[0].node.label, chart.data[0].node.label);
    assert.equal(wide.layout.height, chart.layout.height);
});

test('binary Plotly arrays normalize before sizing, including multidimensional values', () => {
    const array = new Float64Array([1, 2, 3, 4, 5, 6]);
    const packed = { dtype: 'f8', bdata: Buffer.from(array.buffer).toString('base64'), shape: '2, 3' };
    assert.deepEqual(normalizeValue(packed), [[1, 2, 3], [4, 5, 6]]);
    assert.throws(() => normalizeValue({ ...packed, shape: '2, 2' }), /shape/);
});

test('rendered point labels hide collisions and become visible again after resize', () => {
    function rect(left, top, width, height) { return { left, top, width, height, right: left + width, bottom: top + height }; }
    function node(bounds) { return { style: {}, bounds, getBoundingClientRect() { return this.bounds; } }; }
    const first = node(rect(10, 40, 40, 16));
    const collision = node(rect(35, 40, 40, 16));
    const outside = node(rect(280, 40, 40, 16));
    const blocked = node(rect(100, 10, 40, 16));
    const heading = node(rect(100, 10, 40, 16));
    const gd = {
        getBoundingClientRect: () => rect(0, 0, 300, 200),
        querySelectorAll: selector => selector.includes('.gtitle') ? [heading] : [first, collision, outside, blocked]
    };
    assert.equal(resolveTextCollisions(gd), 3);
    assert.equal(first.style.visibility, '');
    assert.equal(collision.style.visibility, 'hidden');
    collision.bounds = rect(60, 70, 40, 16);
    assert.equal(resolveTextCollisions(gd), 2);
    assert.equal(collision.style.visibility, '');
});
