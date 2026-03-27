/**
 * Chart Field — Field Input JS
 *
 * Uses ChartTableEditor (custom editable table, zero deps) for all data entry.
 * Optionally renders a live preview panel using the selected charting library.
 *
 * All DOM queries are relative to the root element via querySelector —
 * no dependency on element IDs (which Craft's namespaceInputs modifies).
 */
(function () {
    'use strict';

    var PIE_TYPES     = ['pie', 'donut', 'doughnut'];
    var NO_AXIS_TYPES = ['pie', 'donut', 'doughnut', 'radar', 'polar', 'polar-area'];

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------
    function ChartFieldInput(root) {
        this.root = root;
        this.allowCustomColors = root.getAttribute('data-allow-custom-colors') === '1';
        this.showAdvanced      = root.getAttribute('data-show-advanced') === '1';
        this.defaultPalette    = [];
        try {
            this.defaultPalette = JSON.parse(root.getAttribute('data-default-palette') || '[]');
        } catch (e) {}

        // Preview
        this._showPreview    = root.getAttribute('data-show-preview') === '1';
        this._chartLibrary   = root.getAttribute('data-chart-library') || 'chartjs';
        this._previewJsAssets = [];
        try {
            this._previewJsAssets = JSON.parse(root.getAttribute('data-preview-js-assets') || '[]');
        } catch (e) {}
        this._previewChart   = null;  // current chart instance
        this._previewTimer   = null;  // debounce timer
        this._libsLoaded     = false; // whether CDN scripts are loaded

        this._tableEditor = null;

        this.state = {
            chartType:  null,
            title:      '',
            subtitle:   '',
            xAxis:      { label: '', type: 'category', categories: [] },
            yAxes:      [{ label: '', min: null, max: null, prefix: '', suffix: '' }],
            series:     [],
            legend:     { enabled: true, position: 'bottom' },
            tooltip:    { enabled: true, shared: false },
            credits:    false,
            responsive: true,
            stacking:   false,
        };

        var hidden = this._q('.js-chart-field-value');
        if (hidden && hidden.value) {
            try { this.state = Object.assign(this.state, JSON.parse(hidden.value)); } catch (e) {}
        }

        // Migrate old single-axis format to yAxes array
        if (!this.state.yAxes) {
            var oldAx = this.state.yAxis || {};
            this.state.yAxes = [{
                label:  oldAx.label  || '',
                min:    oldAx.min    !== undefined ? oldAx.min  : null,
                max:    oldAx.max    !== undefined ? oldAx.max  : null,
                prefix: this.state.valuePrefix || '',
                suffix: this.state.valueSuffix || oldAx.suffix || '',
            }];
        }
        delete this.state.yAxis;
        delete this.state.valuePrefix;
        delete this.state.valueSuffix;

        this._bindEvents();
        this._render();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._q = function (sel) {
        return this.root.querySelector(sel);
    };
    ChartFieldInput.prototype._qq = function (sel) {
        return this.root.querySelectorAll(sel);
    };

    // -----------------------------------------------------------------------
    // Table-mode helpers
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._getTableMode = function () {
        var t = this.state.chartType;
        if (PIE_TYPES.indexOf(t) !== -1) return 'pie';
        if (t === 'scatter') return 'scatter';
        return 'cartesian';
    };

    ChartFieldInput.prototype._buildEditorData = function () {
        var s    = this.state;
        var mode = this._getTableMode();

        if (mode === 'pie') {
            return { series: s.series.length ? s.series : [] };
        }
        if (mode === 'scatter') {
            return { series: s.series };
        }
        return {
            categories: (s.xAxis && s.xAxis.categories) ? s.xAxis.categories : [],
            series:     s.series,
        };
    };

    ChartFieldInput.prototype._applyEditorData = function (data, mode) {
        var s = this.state;

        if (mode === 'pie') {
            s.series = data.series || [];
        } else if (mode === 'scatter') {
            s.series = data.series || [];
        } else {
            s.xAxis            = s.xAxis || {};
            s.xAxis.categories = data.categories || [];
            s.series = (data.series || []).map(function (sr, i) {
                var existing = s.series[i];
                var entry = {
                    name:  sr.name,
                    color: sr.color || (existing ? existing.color : null),
                    data:  sr.data,
                };
                if (sr.type)       entry.type       = sr.type;
                if (sr.yAxisIndex) entry.yAxisIndex = sr.yAxisIndex;
                return entry;
            });
        }
    };

    ChartFieldInput.prototype._getComboTypes = function () {
        var lib = this._chartLibrary;
        if (lib === 'highcharts') {
            return ['line', 'spline', 'column', 'area', 'scatter'];
        }
        // Chart.js and ApexCharts
        return ['line', 'column', 'area', 'scatter'];
    };

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._bindEvents = function () {
        var self = this;

        this.root.addEventListener('input',  function (e) { self._onChange(e); });
        this.root.addEventListener('change', function (e) { self._onChange(e); });

        var form = this.root.closest('form');
        if (form) {
            form.addEventListener('submit', function () {
                if (self._tableEditor) {
                    var mode = self._getTableMode();
                    self._applyEditorData(self._tableEditor.getData(), mode);
                }
                self._serialize();
            });
        }

        // Y Axes add / delete buttons
        this.root.addEventListener('click', function (e) {
            var cf = e.target.getAttribute ? e.target.getAttribute('data-cf') : null;
            if (cf === 'yaxis-add') {
                self._addAxis();
            } else if (cf === 'yaxis-delete') {
                self._deleteAxis(parseInt(e.target.getAttribute('data-axis') || '0', 10));
            }
        });
    };

    ChartFieldInput.prototype._onChange = function (e) {
        var t  = e.target;
        var cf = t.getAttribute('data-cf');
        if (!cf) return;

        switch (cf) {
            case 'title':    this.state.title = t.value; break;
            case 'subtitle': this.state.subtitle = t.value; break;
            case 'xaxis-label': this.state.xAxis.label = t.value; break;
            case 'yaxis-label':
            case 'yaxis-min':
            case 'yaxis-max':
            case 'yaxis-prefix':
            case 'yaxis-suffix': {
                var axIdx = parseInt(t.getAttribute('data-axis') || '0', 10);
                this.state.yAxes = this.state.yAxes || [{}];
                this.state.yAxes[axIdx] = this.state.yAxes[axIdx] || {};
                var axKey = cf.replace('yaxis-', '');
                if (axKey === 'min' || axKey === 'max') {
                    this.state.yAxes[axIdx][axKey] = t.value !== '' ? parseFloat(t.value) : null;
                } else {
                    this.state.yAxes[axIdx][axKey] = t.value;
                }
                break;
            }
            case 'legend-enabled':  this.state.legend.enabled  = t.checked; break;
            case 'legend-position': this.state.legend.position = t.value; break;
            case 'tooltip-enabled': this.state.tooltip.enabled = t.checked; break;
            case 'tooltip-shared':  this.state.tooltip.shared  = t.checked; break;
        }
        this._serialize();
        this._schedulePreview();
    };

    // -----------------------------------------------------------------------
    // Chart type
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._setChartType = function (type) {
        var prevType = this.state.chartType;
        var wasPie   = prevType !== null && PIE_TYPES.indexOf(prevType) !== -1;
        var nowPie   = PIE_TYPES.indexOf(type) !== -1;

        if (prevType !== null && wasPie !== nowPie) {
            this.state.series = [];
        }

        this.state.chartType = type;
        this._updateTypePickerUI(type);
        this._updatePanelVisibility(type);
        this._destroyGrid();
        this._initGrid();
        this._serialize();
        this._schedulePreview();
    };

    ChartFieldInput.prototype._updateTypePickerUI = function (type) {
        var menu = this._menuEl || this._q('.chart-field-type-menu');
        if (!menu) return;

        // Mark the selected <li> — Garnish uses .sel on the <li>, not the <a>
        menu.querySelectorAll('li').forEach(function (li) {
            var a = li.querySelector('[data-type]');
            li.classList.toggle('sel', !!(a && a.getAttribute('data-type') === type));
        });

        // Update trigger button: clone icon + set label from the selected option
        var selectedOpt = menu.querySelector('[data-type="' + type + '"]');
        if (!selectedOpt) return;

        var trigIcon = this._q('.js-chart-type-icon');
        var srcIcon  = selectedOpt.querySelector('.chart-field-type-picker__icon');
        if (trigIcon && srcIcon) trigIcon.innerHTML = srcIcon.innerHTML;

        var trigLabel = this._q('.js-chart-type-label');
        if (trigLabel) trigLabel.textContent = selectedOpt.getAttribute('data-label') || type;
    };

    ChartFieldInput.prototype._initTypeDropdown = function () {
        var self = this;
        var btn  = this._q('.js-chart-type-btn');
        if (!btn || typeof Garnish === 'undefined' || !Garnish.MenuBtn) return;

        // Store ref BEFORE new Garnish.MenuBtn() — it immediately detaches the
        // adjacent .menu element from the DOM via $btn.next('.menu').detach().
        this._menuEl = this._q('.chart-field-type-menu');

        new Garnish.MenuBtn(btn, {
            onOptionSelect: function (option) {
                var type = option.getAttribute('data-type');
                if (type) self._setChartType(type);
            },
        });
    };

    ChartFieldInput.prototype._updatePanelVisibility = function (type) {
        if (!type) return;
        var noAxes     = NO_AXIS_TYPES.indexOf(type) !== -1;
        var axesPanel  = this._q('.js-axes-panel');
        if (axesPanel) axesPanel.style.display = noAxes ? 'none' : '';
        var yaxesSection = this._q('.js-yaxes-section');
        if (yaxesSection) yaxesSection.style.display = noAxes ? 'none' : '';
    };

    // -----------------------------------------------------------------------
    // Grid — ChartTableEditor integration
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._initGrid = function () {
        var container = this._q('.js-chart-grid');
        if (!container || !this.state.chartType) return;

        if (typeof ChartTableEditor === 'undefined') {
            container.innerHTML = '<p class="chart-field-grid-hint">Table editor not loaded.</p>';
            return;
        }

        container.innerHTML = '';

        var self = this;
        var mode = this._getTableMode();

        this._tableEditor = new ChartTableEditor(container, {
            mode:              mode,
            data:              this._buildEditorData(),
            defaultPalette:    this.defaultPalette,
            allowCustomColors: this.allowCustomColors,
            allowSeriesTypes:  mode === 'cartesian',
            comboTypes:        this._getComboTypes(),
            yAxisCount:        (this.state.yAxes || [{}]).length,
            onChange: function (data) {
                self._applyEditorData(data, mode);
                self._serialize();
                self._schedulePreview();
            },
        });
    };

    ChartFieldInput.prototype._destroyGrid = function () {
        if (this._tableEditor) {
            this._tableEditor.destroy();
            this._tableEditor = null;
        }
        var container = this._q('.js-chart-grid');
        if (container) container.innerHTML = '';
    };

    // -----------------------------------------------------------------------
    // Y Axes management
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._renderAxesUI = function () {
        var container = this._q('.js-yaxes-container');
        if (!container) return;
        container.innerHTML = '';
        var self = this;
        (this.state.yAxes || [{}]).forEach(function (ax, idx) {
            container.appendChild(self._buildAxisEntry(ax, idx));
        });
    };

    ChartFieldInput.prototype._buildAxisEntry = function (ax, idx) {
        var div = document.createElement('div');
        div.className = 'chart-field-yaxis-entry';
        div.setAttribute('data-axis', idx);

        var header = document.createElement('div');
        header.className = 'chart-field-yaxis-entry__header';

        var title = document.createElement('span');
        title.className   = 'chart-field-yaxis-entry__title';
        title.textContent = 'Y Axis ' + (idx + 1);
        header.appendChild(title);

        if (idx > 0) {
            var delBtn = document.createElement('button');
            delBtn.type        = 'button';
            delBtn.className   = 'chart-field-yaxis-entry__delete';
            delBtn.textContent = '\u00d7'; // × character
            delBtn.setAttribute('data-axis', idx);
            delBtn.setAttribute('data-cf',   'yaxis-delete');
            delBtn.setAttribute('title', 'Remove Y Axis ' + (idx + 1));
            header.appendChild(delBtn);
        }
        div.appendChild(header);

        var fields = document.createElement('div');
        fields.className = 'chart-field-yaxis-entry__fields';

        var labelRow = document.createElement('div');
        labelRow.className = 'chart-field-field-row';
        var labelLbl = document.createElement('label');
        labelLbl.className   = 'chart-field-label';
        labelLbl.textContent = 'Label';
        var labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'text fullwidth';
        labelInput.setAttribute('data-cf',   'yaxis-label');
        labelInput.setAttribute('data-axis',  idx);
        labelInput.value = ax.label || '';
        labelRow.appendChild(labelLbl);
        labelRow.appendChild(labelInput);
        fields.appendChild(labelRow);

        var inlineRow = document.createElement('div');
        inlineRow.className = 'chart-field-field-row chart-field-field-row--inline';

        var mkField = function (labelText, cf, placeholder, type, val) {
            var wrap = document.createElement('div');
            var lbl  = document.createElement('label');
            lbl.className   = 'chart-field-label';
            lbl.textContent = labelText;
            var inp = document.createElement('input');
            inp.type = type || 'text';
            inp.className = 'text';
            inp.style.width = '70px';
            inp.setAttribute('data-cf',   cf);
            inp.setAttribute('data-axis', idx);
            inp.placeholder = placeholder;
            if (val !== null && val !== undefined && val !== '') inp.value = val;
            wrap.appendChild(lbl);
            wrap.appendChild(inp);
            return wrap;
        };

        inlineRow.appendChild(mkField('Min',    'yaxis-min',    'auto', 'number', ax.min));
        inlineRow.appendChild(mkField('Max',    'yaxis-max',    'auto', 'number', ax.max));
        inlineRow.appendChild(mkField('Prefix', 'yaxis-prefix', '$',    'text',   ax.prefix));
        inlineRow.appendChild(mkField('Suffix', 'yaxis-suffix', '\u20ac', 'text', ax.suffix));
        fields.appendChild(inlineRow);

        div.appendChild(fields);
        return div;
    };

    ChartFieldInput.prototype._addAxis = function () {
        this.state.yAxes = this.state.yAxes || [{}];
        this.state.yAxes.push({ label: '', min: null, max: null, prefix: '', suffix: '' });
        this._renderAxesUI();
        this._updateTableEditorYAxisCount();
        this._serialize();
        this._schedulePreview();
    };

    ChartFieldInput.prototype._deleteAxis = function (idx) {
        var axes = this.state.yAxes || [];
        if (idx <= 0 || idx >= axes.length) return;
        axes.splice(idx, 1);
        var maxIdx = axes.length - 1;
        (this.state.series || []).forEach(function (s) {
            if ((s.yAxisIndex || 0) >= idx) {
                s.yAxisIndex = Math.max(0, (s.yAxisIndex || 0) - 1);
                if (s.yAxisIndex > maxIdx) s.yAxisIndex = 0;
                if (s.yAxisIndex === 0) delete s.yAxisIndex;
            }
        });
        this._renderAxesUI();
        this._updateTableEditorYAxisCount();
        this._serialize();
        this._schedulePreview();
    };

    ChartFieldInput.prototype._updateTableEditorYAxisCount = function () {
        if (this._tableEditor && typeof this._tableEditor.setYAxisCount === 'function') {
            this._tableEditor.setYAxisCount((this.state.yAxes || [{}]).length);
        }
    };

    // -----------------------------------------------------------------------
    // Restore from existing state on page load
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._render = function () {
        var s = this.state;

        this._initTypeDropdown();

        if (s.chartType) {
            this._updateTypePickerUI(s.chartType);
            this._updatePanelVisibility(s.chartType);
        }

        var setVal = function (root, sel, val) {
            var el = root.querySelector(sel);
            if (el) el.value = val;
        };
        var setChecked = function (root, sel, val) {
            var el = root.querySelector(sel);
            if (el) el.checked = !!val;
        };
        var r = this.root;

        setVal(r, '[data-cf="title"]',       s.title       || '');
        setVal(r, '[data-cf="subtitle"]',    s.subtitle    || '');
        setVal(r, '[data-cf="xaxis-label"]', s.xAxis.label || '');
        this._renderAxesUI();

        if (this.showAdvanced) {
            setChecked(r, '[data-cf="legend-enabled"]',  s.legend.enabled  !== false);
            setVal(r,     '[data-cf="legend-position"]', s.legend.position || 'bottom');
            setChecked(r, '[data-cf="tooltip-enabled"]', s.tooltip.enabled !== false);
            setChecked(r, '[data-cf="tooltip-shared"]',  !!s.tooltip.shared);
        }

        if (s.chartType) {
            this._initGrid();
        } else {
            var container = this._q('.js-chart-grid');
            if (container) {
                container.innerHTML = '<p class="chart-field-grid-hint">Select a chart type above to start entering data.</p>';
            }
        }

        if (this._showPreview) {
            this._initPreview();
        }
    };

    // -----------------------------------------------------------------------
    // Serialize state → hidden input
    // -----------------------------------------------------------------------
    ChartFieldInput.prototype._serialize = function () {
        var hidden = this._q('.js-chart-field-value');
        if (hidden) hidden.value = JSON.stringify(this.state);
    };

    // -----------------------------------------------------------------------
    // Live Preview
    // -----------------------------------------------------------------------

    /**
     * Load chart library scripts from CDN (once), then trigger initial render.
     */
    ChartFieldInput.prototype._initPreview = function () {
        if (!this._showPreview) return;
        var self = this;

        this._loadScripts(this._previewJsAssets, function () {
            self._libsLoaded = true;
            if (self.state.chartType) {
                self._renderPreview();
            }
        });
    };

    /**
     * Load an array of script URLs sequentially (each waits for the previous).
     * Skips scripts that are already in the DOM.
     */
    ChartFieldInput.prototype._loadScripts = function (urls, callback) {
        if (!urls || !urls.length) { callback(); return; }
        var url  = urls[0];
        var rest = urls.slice(1);
        var self = this;

        if (document.querySelector('script[src="' + url + '"]')) {
            self._loadScripts(rest, callback);
            return;
        }

        var s    = document.createElement('script');
        s.src    = url;
        s.onload = function () { self._loadScripts(rest, callback); };
        s.onerror = function () {
            console.warn('Chart Field: failed to load preview script: ' + url);
            callback(); // continue anyway
        };
        document.head.appendChild(s);
    };

    /**
     * Schedule a debounced preview refresh (500ms).
     */
    ChartFieldInput.prototype._schedulePreview = function () {
        if (!this._showPreview || !this._libsLoaded) return;
        var self = this;
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(function () {
            self._renderPreview();
        }, 500);
    };

    /**
     * POST state to server, receive library config JSON, render chart.
     */
    ChartFieldInput.prototype._renderPreview = function () {
        if (!this._showPreview || !this._libsLoaded) return;
        if (!this.state.chartType) return;

        var self      = this;
        var container = this._q('.js-preview-container');
        if (!container) return;

        // Show loading state
        container.classList.add('chart-field-preview__container--loading');

        Craft.postActionRequest(
            'chart-field/preview/render',
            {
                state:   JSON.stringify(this.state),
                library: this._chartLibrary,
            },
            function (response, textStatus) {
                container.classList.remove('chart-field-preview__container--loading');

                if (textStatus !== 'success' || !response || response.error) {
                    console.warn('Chart Field preview error:', response && response.error);
                    return;
                }

                self._applyPreviewChart(container, response.config, response.library);
            }
        );
    };

    /**
     * Destroy previous chart instance and render a new one.
     */
    ChartFieldInput.prototype._applyPreviewChart = function (container, config, library) {
        // Destroy previous instance
        if (this._previewChart) {
            try { this._previewChart.destroy(); } catch (e) {}
            this._previewChart = null;
        }
        container.innerHTML = '';

        var yAxes = this.state.yAxes || [{}];

        if (library === 'chartjs') {
            var canvas = document.createElement('canvas');
            canvas.style.height = '400px';
            container.appendChild(canvas);
            if (typeof Chart !== 'undefined') {
                var hasChartJsFmt = yAxes.some(function (ax) { return ax.prefix || ax.suffix; });
                if (hasChartJsFmt) {
                    var cjsScaleMap = {};
                    yAxes.forEach(function (ax, i) { cjsScaleMap[i === 0 ? 'y' : 'y' + i] = i; });
                    var cjsFmtArr = yAxes.map(function (ax) { return { prefix: ax.prefix || '', suffix: ax.suffix || '' }; });
                    config.options = config.options || {};
                    config.options.scales = config.options.scales || {};
                    yAxes.forEach(function (ax, i) {
                        var sid = i === 0 ? 'y' : 'y' + i;
                        if (ax.prefix || ax.suffix) {
                            config.options.scales[sid] = config.options.scales[sid] || {};
                            config.options.scales[sid].ticks = config.options.scales[sid].ticks || {};
                            (function (p, s) {
                                config.options.scales[sid].ticks.callback = function (val) { return p + val + s; };
                            })(ax.prefix || '', ax.suffix || '');
                        }
                    });
                    config.options.plugins = config.options.plugins || {};
                    config.options.plugins.tooltip = config.options.plugins.tooltip || {};
                    config.options.plugins.tooltip.callbacks = {
                        label: function (ctx) {
                            var aid = ctx.dataset && ctx.dataset.yAxisID ? ctx.dataset.yAxisID : 'y';
                            var ai  = cjsScaleMap[aid] !== undefined ? cjsScaleMap[aid] : 0;
                            var f   = cjsFmtArr[ai] || { prefix: '', suffix: '' };
                            var val = ctx.parsed && ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.formattedValue;
                            var lbl = ctx.dataset ? ctx.dataset.label || '' : '';
                            return (lbl ? lbl + ': ' : '') + (f.prefix || '') + val + (f.suffix || '');
                        }
                    };
                }
                this._previewChart = new Chart(canvas, config);
            }

        } else if (library === 'highcharts') {
            var div = document.createElement('div');
            div.style.height = '400px';
            container.appendChild(div);
            if (typeof Highcharts !== 'undefined') {
                this._previewChart = Highcharts.chart(div, config);
            }

        } else if (library === 'apexcharts') {
            var div2 = document.createElement('div');
            container.appendChild(div2);
            if (typeof ApexCharts !== 'undefined') {
                var apxSeriesList = this.state.series || [];
                var hasApxFmt = yAxes.some(function (ax) { return ax.prefix || ax.suffix; });
                if (hasApxFmt) {
                    var apxPerSeries = apxSeriesList.map(function (s) {
                        var ai = s.yAxisIndex || 0;
                        var ax = yAxes[ai] || yAxes[0] || {};
                        return { prefix: ax.prefix || '', suffix: ax.suffix || '' };
                    });
                    config.tooltip = config.tooltip || {};
                    config.tooltip.y = apxPerSeries.map(function (f) {
                        return { formatter: (function (p, s) { return function (val) { return p + val + s; }; })(f.prefix, f.suffix) };
                    });
                    var ya = Array.isArray(config.yaxis) ? config.yaxis : (config.yaxis ? [config.yaxis] : []);
                    var seenApxAxis = {};
                    apxSeriesList.forEach(function (s, i) {
                        var ai = s.yAxisIndex || 0;
                        var f  = apxPerSeries[i] || { prefix: '', suffix: '' };
                        if (!seenApxAxis[ai] && ya[i] && !ya[i].seriesName && (f.prefix || f.suffix)) {
                            seenApxAxis[ai] = true;
                            ya[i].labels = ya[i].labels || {};
                            ya[i].labels.formatter = (function (p, sf) { return function (val) { return p + val + sf; }; })(f.prefix, f.suffix);
                        }
                    });
                }
                this._previewChart = new ApexCharts(div2, config);
                this._previewChart.render();
            }
        }
    };

    // -----------------------------------------------------------------------
    // Bootstrap
    // -----------------------------------------------------------------------
    function initAll() {
        document.querySelectorAll('[data-chart-field]:not([data-chart-field-ready])').forEach(function (root) {
            root.setAttribute('data-chart-field-ready', '1');
            new ChartFieldInput(root);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }

    if (typeof Garnish !== 'undefined') {
        Garnish.on(Garnish.Base, 'init', initAll);
    }

    var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length) { initAll(); break; }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
