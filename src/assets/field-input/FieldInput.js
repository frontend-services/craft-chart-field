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
            chartType:   null,
            title:       '',
            subtitle:    '',
            xAxis:       { label: '', type: 'category', categories: [] },
            yAxis:       { label: '', min: null, max: null, suffix: '' },
            series:      [],
            legend:      { enabled: true, position: 'bottom' },
            tooltip:     { enabled: true, shared: false },
            credits:     false,
            responsive:  true,
            stacking:    false,
            valuePrefix: null,
            valueSuffix: null,
        };

        var hidden = this._q('.js-chart-field-value');
        if (hidden && hidden.value) {
            try { this.state = Object.assign(this.state, JSON.parse(hidden.value)); } catch (e) {}
        }

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
                return {
                    name:  sr.name,
                    color: sr.color || (existing ? existing.color : null),
                    data:  sr.data,
                };
            });
        }
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
    };

    ChartFieldInput.prototype._onChange = function (e) {
        var t  = e.target;
        var cf = t.getAttribute('data-cf');
        if (!cf) return;

        switch (cf) {
            case 'title':    this.state.title = t.value; break;
            case 'subtitle': this.state.subtitle = t.value; break;
            case 'xaxis-label': this.state.xAxis.label = t.value; break;
            case 'yaxis-label':  this.state.yAxis.label  = t.value; break;
            case 'yaxis-min':    this.state.yAxis.min    = t.value !== '' ? parseFloat(t.value) : null; break;
            case 'yaxis-max':    this.state.yAxis.max    = t.value !== '' ? parseFloat(t.value) : null; break;
            case 'yaxis-suffix': this.state.yAxis.suffix = t.value; break;
            case 'legend-enabled':  this.state.legend.enabled   = t.checked; break;
            case 'legend-position': this.state.legend.position  = t.value; break;
            case 'tooltip-enabled': this.state.tooltip.enabled  = t.checked; break;
            case 'tooltip-shared':  this.state.tooltip.shared   = t.checked; break;
            case 'value-prefix': this.state.valuePrefix = t.value || null; break;
            case 'value-suffix': this.state.valueSuffix = t.value || null; break;
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
        var noAxes    = NO_AXIS_TYPES.indexOf(type) !== -1;
        var axesPanel = this._q('.js-axes-panel');
        if (axesPanel) axesPanel.style.display = noAxes ? 'none' : '';
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
        setVal(r, '[data-cf="yaxis-label"]',  s.yAxis.label  || '');
        setVal(r, '[data-cf="yaxis-suffix"]', s.yAxis.suffix || '');
        setVal(r, '[data-cf="value-prefix"]', s.valuePrefix  || '');
        setVal(r, '[data-cf="value-suffix"]', s.valueSuffix  || '');
        if (s.yAxis.min !== null) setVal(r, '[data-cf="yaxis-min"]', s.yAxis.min);
        if (s.yAxis.max !== null) setVal(r, '[data-cf="yaxis-max"]', s.yAxis.max);

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

        var prefix    = this.state.valuePrefix || '';
        var suffix    = this.state.valueSuffix || '';
        var yAxisSuffix = (this.state.yAxis && this.state.yAxis.suffix) || '';

        if (library === 'chartjs') {
            var canvas = document.createElement('canvas');
            canvas.style.height = '400px';
            container.appendChild(canvas);
            if (typeof Chart !== 'undefined') {
                // Apply formatters — renderHtml() normally injects these via PHP but
                // the preview receives only buildConfig() output without the JS callbacks.
                if (prefix || suffix) {
                    config.options = config.options || {};
                    config.options.plugins = config.options.plugins || {};
                    config.options.plugins.tooltip = config.options.plugins.tooltip || {};
                    config.options.plugins.tooltip.callbacks = {
                        label: function (ctx) {
                            var val = ctx.parsed && ctx.parsed.y !== undefined
                                ? ctx.parsed.y
                                : (typeof ctx.parsed === 'number' ? ctx.parsed : ctx.formattedValue);
                            var lbl = ctx.dataset ? ctx.dataset.label || '' : '';
                            return (lbl ? lbl + ': ' : '') + prefix + val + suffix;
                        }
                    };
                }
                if (yAxisSuffix) {
                    config.options = config.options || {};
                    config.options.scales = config.options.scales || {};
                    config.options.scales.y = config.options.scales.y || {};
                    config.options.scales.y.ticks = config.options.scales.y.ticks || {};
                    config.options.scales.y.ticks.callback = function (val) { return val + yAxisSuffix; };
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
                // Same fix as Chart.js — apply prefix/suffix formatter client-side.
                if (prefix || suffix) {
                    config.tooltip = config.tooltip || {};
                    config.tooltip.y = { formatter: function (val) { return prefix + val + suffix; } };
                    if (config.yaxis) {
                        config.yaxis.labels = config.yaxis.labels || {};
                        config.yaxis.labels.formatter = function (val) { return prefix + val + suffix; };
                    }
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
