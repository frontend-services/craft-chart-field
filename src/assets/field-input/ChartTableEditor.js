/**
 * ChartTableEditor — self-contained editable table for the Chart Field plugin.
 *
 * No external dependencies. Supports three modes: cartesian, pie, scatter.
 * Handles Excel/Google Sheets paste via the Clipboard API (TSV format).
 *
 * Usage:
 *   var editor = new ChartTableEditor(containerElement, {
 *       mode: 'cartesian',          // 'cartesian' | 'pie' | 'scatter'
 *       data: { categories, series },
 *       defaultPalette: ['#4A90D9', ...],
 *       allowCustomColors: true,
 *       onChange: function(data) { ... }
 *   });
 *
 *   editor.getData()   → canonical data object
 *   editor.setData(d)  → reload from canonical data
 *   editor.destroy()   → clean up
 */
(function (global) {
    'use strict';

    var COMBO_TYPE_LABELS = {
        'line':    'Line',
        'spline':  'Spline',
        'column':  'Column',
        'area':    'Area',
        'scatter': 'Scatter',
    };

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    function ChartTableEditor(container, options) {
        this._container = container;
        this._mode      = options.mode || 'cartesian';
        this._palette   = options.defaultPalette || ['#4A90D9','#D94A4A','#50C878','#FFB347','#9B59B6','#1ABC9C','#E67E22','#34495E'];
        this._allowColors      = options.allowCustomColors !== false;
        this._allowSeriesTypes = options.allowSeriesTypes === true;
        this._comboTypes       = options.comboTypes || ['line', 'column', 'area', 'scatter'];
        this._yAxisCount       = options.yAxisCount || 1;
        this._onChangeCb  = options.onChange || null;
        this._changeTimer = null;
        this._prevValue   = null; // for Escape revert

        // Internal state
        // _headers:       column header strings (includes 'Category' at [0] for cartesian)
        // _colors:        aligned with _headers — null for non-series columns
        // _seriesTypes:   per-series type overrides — '' means "use global chart type"
        // _yAxisIndices:  per-column axis index (0-based); null for Category column
        // _rows:          2D array of raw string cell values
        this._headers      = [];
        this._colors       = [];
        this._seriesTypes  = [];
        this._yAxisIndices = [];
        this._rows         = [];

        this._buildDOM();
        this._bindEvents();
        this.setData(options.data || {});
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._color = function (idx) {
        return this._palette[idx % this._palette.length] || '#4A90D9';
    };

    // Number of data columns (excludes row-actions column)
    ChartTableEditor.prototype._colCount = function () {
        return this._headers.length;
    };

    ChartTableEditor.prototype._scheduleChange = function () {
        var self = this;
        clearTimeout(this._changeTimer);
        this._changeTimer = setTimeout(function () {
            if (self._onChangeCb) self._onChangeCb(self.getData());
        }, 100);
    };

    // -------------------------------------------------------------------------
    // DOM build (one-time structure; content populated by _renderAll)
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._buildDOM = function () {
        this._container.innerHTML = '';

        var wrap = document.createElement('div');
        wrap.className = 'cte-container';

        var scrollWrap = document.createElement('div');
        scrollWrap.className = 'cte-scroll';

        var table = document.createElement('table');
        table.className = 'cte-table';

        var thead = document.createElement('thead');
        thead.className = 'cte-thead';
        var tbody = document.createElement('tbody');
        tbody.className = 'cte-tbody';

        table.appendChild(thead);
        table.appendChild(tbody);
        scrollWrap.appendChild(table);

        var toolbar = document.createElement('div');
        toolbar.className = 'cte-toolbar';

        var addRowBtn = document.createElement('button');
        addRowBtn.type = 'button';
        addRowBtn.className = 'cte-btn cte-btn--add-row';
        addRowBtn.setAttribute('data-cte-action', 'add-row');
        addRowBtn.textContent = '+ Add Row';

        toolbar.appendChild(addRowBtn);

        if (this._mode === 'cartesian') {
            var addSeriesBtn = document.createElement('button');
            addSeriesBtn.type = 'button';
            addSeriesBtn.className = 'cte-btn cte-btn--add-series';
            addSeriesBtn.setAttribute('data-cte-action', 'add-series');
            addSeriesBtn.textContent = '+ Add Series';
            toolbar.appendChild(addSeriesBtn);
        }

        wrap.appendChild(scrollWrap);
        wrap.appendChild(toolbar);
        this._container.appendChild(wrap);

        // Store refs
        this._thead = thead;
        this._tbody = tbody;
        this._wrap  = wrap;
    };

    // -------------------------------------------------------------------------
    // Full re-render (called after any structural change)
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._renderAll = function (focusRow, focusCol) {
        this._renderHeader();
        this._renderBody();
        this._updateDeleteVisibility();

        if (focusRow !== undefined && focusCol !== undefined) {
            var target = this._cellInput(focusRow, focusCol);
            if (target) {
                target.focus();
                try { target.setSelectionRange(target.value.length, target.value.length); } catch (e) {}
            }
        }
    };

    ChartTableEditor.prototype._renderHeader = function () {
        this._thead.innerHTML = '';
        var tr = document.createElement('tr');
        var self = this;

        this._headers.forEach(function (name, j) {
            var th = document.createElement('th');
            th.className = 'cte-th';
            th.setAttribute('data-cte-col', j);

            var isEditable = self._mode === 'cartesian' && j > 0;
            if (isEditable) th.classList.add('cte-th--editable');

            var inner = document.createElement('div');
            inner.className = 'cte-th__inner';

            if (isEditable && self._allowColors) {
                var colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.className = 'cte-th__color';
                colorInput.value = self._colors[j] || self._color(j);
                colorInput.setAttribute('data-cte-color-col', j);
                colorInput.title = 'Series color';
                inner.appendChild(colorInput);
            }

            var label = document.createElement('span');
            label.className = 'cte-th__label';
            label.textContent = name;
            inner.appendChild(label);

            if (isEditable) {
                var delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'cte-th__delete';
                delBtn.setAttribute('data-cte-action', 'delete-series');
                delBtn.setAttribute('data-cte-col', j);
                delBtn.setAttribute('title', 'Remove series');
                delBtn.innerHTML = '&times;';
                inner.appendChild(delBtn);
            }

            th.appendChild(inner);

            if (isEditable && self._allowSeriesTypes) {
                var typeRow = document.createElement('div');
                typeRow.className = 'cte-th__type-row';

                var typeSelect = document.createElement('select');
                typeSelect.className = 'cte-th__type-select';
                typeSelect.setAttribute('data-cte-type-col', j);

                var defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = '— Auto —';
                typeSelect.appendChild(defaultOpt);

                self._comboTypes.forEach(function (typeVal) {
                    var opt = document.createElement('option');
                    opt.value = typeVal;
                    opt.textContent = COMBO_TYPE_LABELS[typeVal] || typeVal;
                    typeSelect.appendChild(opt);
                });

                typeSelect.value = self._seriesTypes[j] || '';
                typeRow.appendChild(typeSelect);
                th.appendChild(typeRow);
            }

            // Per-series Y axis selector (only when multiple axes exist)
            if (isEditable && self._yAxisCount > 1) {
                var axisRow = document.createElement('div');
                axisRow.className = 'cte-th__axis-row';

                var axisSelect = document.createElement('select');
                axisSelect.className = 'cte-th__axis-select';
                axisSelect.setAttribute('data-cte-axis-col', j);

                for (var a = 0; a < self._yAxisCount; a++) {
                    var axOpt = document.createElement('option');
                    axOpt.value = a;
                    axOpt.textContent = 'Y' + (a + 1);
                    axisSelect.appendChild(axOpt);
                }
                axisSelect.value = self._yAxisIndices[j] || 0;
                axisRow.appendChild(axisSelect);
                th.appendChild(axisRow);
            }

            tr.appendChild(th);
        });

        // Empty header for row-actions column
        var actionTh = document.createElement('th');
        actionTh.className = 'cte-th cte-th--action';
        tr.appendChild(actionTh);

        this._thead.appendChild(tr);
    };

    ChartTableEditor.prototype._renderBody = function () {
        this._tbody.innerHTML = '';
        for (var i = 0; i < this._rows.length; i++) {
            this._tbody.appendChild(this._buildRow(i));
        }
    };

    ChartTableEditor.prototype._buildRow = function (rowIdx) {
        var self = this;
        var tr = document.createElement('tr');
        tr.className = 'cte-row';
        tr.setAttribute('data-cte-row', rowIdx);

        this._headers.forEach(function (name, colIdx) {
            var td = document.createElement('td');
            td.className = 'cte-td';
            td.setAttribute('data-cte-col', colIdx);

            var input = self._buildInput(rowIdx, colIdx);
            td.appendChild(input);
            tr.appendChild(td);
        });

        // Row delete button
        var actionTd = document.createElement('td');
        actionTd.className = 'cte-td cte-td--action';

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cte-row__delete';
        delBtn.setAttribute('data-cte-action', 'delete-row');
        delBtn.setAttribute('data-cte-row', rowIdx);
        delBtn.setAttribute('title', 'Remove row');
        delBtn.innerHTML = '&times;';
        actionTd.appendChild(delBtn);

        tr.appendChild(actionTd);
        return tr;
    };

    ChartTableEditor.prototype._buildInput = function (rowIdx, colIdx) {
        var input;
        var val = (this._rows[rowIdx] || [])[colIdx] || '';

        if (this._mode === 'pie' && colIdx === 2 && this._allowColors) {
            input = document.createElement('input');
            input.type = 'color';
            input.className = 'cte-input cte-input--color';
            input.value = /^#[0-9a-fA-F]{3,6}$/.test(val) ? val : '#4a90d9';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            var isNumeric = (this._mode === 'cartesian' && colIdx > 0) ||
                            (this._mode === 'pie' && colIdx === 1) ||
                            (this._mode === 'scatter' && colIdx > 0);
            if (isNumeric) {
                input.setAttribute('inputmode', 'numeric');
                input.className = 'cte-input cte-input--numeric';
            } else {
                input.className = 'cte-input';
            }
            input.value = val;
        }

        input.setAttribute('data-cte-row', rowIdx);
        input.setAttribute('data-cte-col', colIdx);
        return input;
    };

    // -------------------------------------------------------------------------
    // Update delete button visibility
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._updateDeleteVisibility = function () {
        var rowCount   = this._rows.length;
        var seriesCount = this._mode === 'cartesian'
            ? this._headers.filter(function (h, i) { return i > 0; }).length
            : 0;

        // Row delete buttons: hide when only 1 row
        this._tbody.querySelectorAll('.cte-row__delete').forEach(function (btn) {
            btn.style.visibility = rowCount <= 1 ? 'hidden' : '';
        });

        // Series delete buttons: hide when only 1 series (cartesian)
        this._thead.querySelectorAll('.cte-th__delete').forEach(function (btn) {
            btn.style.visibility = seriesCount <= 1 ? 'hidden' : '';
        });
    };

    // -------------------------------------------------------------------------
    // Cell navigation helpers
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._cellInput = function (rowIdx, colIdx) {
        return this._tbody.querySelector(
            'input[data-cte-row="' + rowIdx + '"][data-cte-col="' + colIdx + '"]'
        );
    };

    ChartTableEditor.prototype._focusCell = function (rowIdx, colIdx) {
        rowIdx = Math.max(0, Math.min(rowIdx, this._rows.length - 1));
        colIdx = Math.max(0, Math.min(colIdx, this._colCount() - 1));
        var target = this._cellInput(rowIdx, colIdx);
        if (target) { target.focus(); return true; }
        return false;
    };

    // -------------------------------------------------------------------------
    // Event delegation
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._bindEvents = function () {
        var self = this;

        // Input: sync value to _rows
        this._wrap.addEventListener('input', function (e) {
            var input = e.target.closest
                ? e.target.closest('input[data-cte-row]')
                : (e.target.getAttribute && e.target.getAttribute('data-cte-row') !== null ? e.target : null);
            if (!input) return;
            var r = parseInt(input.getAttribute('data-cte-row'), 10);
            var c = parseInt(input.getAttribute('data-cte-col'), 10);
            if (self._rows[r]) self._rows[r][c] = input.value;
            self._scheduleChange();
        });

        // Change (for color pickers and type selects which fire change, not input)
        this._wrap.addEventListener('change', function (e) {
            // Axis selector in column header
            var axisColStr = e.target.getAttribute ? e.target.getAttribute('data-cte-axis-col') : null;
            if (axisColStr !== null) {
                self._yAxisIndices[parseInt(axisColStr, 10)] = parseInt(e.target.value, 10);
                self._scheduleChange();
                return;
            }

            // Series type select in column header
            var typeColStr = e.target.getAttribute ? e.target.getAttribute('data-cte-type-col') : null;
            if (typeColStr !== null) {
                self._seriesTypes[parseInt(typeColStr, 10)] = e.target.value;
                self._scheduleChange();
                return;
            }

            // Series color picker in column header
            var colorColStr = e.target.getAttribute ? e.target.getAttribute('data-cte-color-col') : null;
            if (colorColStr !== null) {
                self._colors[parseInt(colorColStr, 10)] = e.target.value;
                self._scheduleChange();
                return;
            }

            // Cell inputs (including pie-mode color picker)
            var input = e.target.closest
                ? e.target.closest('input[data-cte-row]')
                : (e.target.getAttribute && e.target.getAttribute('data-cte-row') !== null ? e.target : null);
            if (!input) return;
            var r = parseInt(input.getAttribute('data-cte-row'), 10);
            var c = parseInt(input.getAttribute('data-cte-col'), 10);
            if (self._rows[r]) self._rows[r][c] = input.value;
            self._scheduleChange();
        });

        // Focus: save previous value for Escape revert
        this._wrap.addEventListener('focus', function (e) {
            var input = e.target;
            if (input && input.getAttribute && input.getAttribute('data-cte-row') !== null) {
                self._prevValue = input.value;
            }
        }, true);

        // Keydown: Tab, Enter, Escape navigation
        this._wrap.addEventListener('keydown', function (e) {
            var input = e.target;
            if (!input || !input.getAttribute) return;

            // Header rename input
            if (input.classList && input.classList.contains('cte-th__rename-input')) {
                if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                if (e.key === 'Escape') { input.dataset.cteCancelled = '1'; input.blur(); }
                return;
            }

            var rowStr = input.getAttribute('data-cte-row');
            if (rowStr === null) return;

            var r = parseInt(rowStr, 10);
            var c = parseInt(input.getAttribute('data-cte-col'), 10);

            if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Prev cell
                    if (c > 0) {
                        self._focusCell(r, c - 1);
                    } else if (r > 0) {
                        self._focusCell(r - 1, self._colCount() - 1);
                    }
                } else {
                    // Next cell
                    if (c < self._colCount() - 1) {
                        self._focusCell(r, c + 1);
                    } else if (r < self._rows.length - 1) {
                        self._focusCell(r + 1, 0);
                    } else {
                        // Tab past last cell → add row, focus first cell of new row
                        self._addRow();
                        self._focusCell(self._rows.length - 1, 0);
                    }
                }
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                if (r < self._rows.length - 1) {
                    self._focusCell(r + 1, c);
                } else {
                    self._addRow();
                    self._focusCell(self._rows.length - 1, c);
                }
                return;
            }

            if (e.key === 'Escape') {
                if (self._prevValue !== null) {
                    input.value = self._prevValue;
                    if (self._rows[r]) self._rows[r][c] = self._prevValue;
                }
                input.blur();
                return;
            }
        });

        // Paste
        this._wrap.addEventListener('paste', function (e) {
            var input = e.target;
            if (!input || !input.getAttribute) return;
            var rowStr = input.getAttribute('data-cte-row');
            if (rowStr === null) return;

            var text = (e.clipboardData || window.clipboardData).getData('text');
            if (!text) return;

            e.preventDefault();

            var anchorRow = parseInt(rowStr, 10);
            var anchorCol = parseInt(input.getAttribute('data-cte-col'), 10);

            var pastedRows = text
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .split('\n')
                .filter(function (line) { return line.length > 0; })
                .map(function (line) { return line.split('\t'); });

            if (pastedRows.length === 0) return;

            // Determine how many extra cols we need (cartesian only)
            if (self._mode === 'cartesian') {
                var maxPastedCols = 0;
                pastedRows.forEach(function (pr) {
                    maxPastedCols = Math.max(maxPastedCols, pr.length);
                });
                var neededCols = anchorCol + maxPastedCols;
                while (neededCols > self._colCount()) {
                    self._addSeriesQuiet();
                }
            }

            // Fill cells
            for (var ri = 0; ri < pastedRows.length; ri++) {
                var targetRow = anchorRow + ri;
                if (targetRow >= self._rows.length) {
                    self._addRowQuiet();
                }
                for (var ci = 0; ci < pastedRows[ri].length; ci++) {
                    var targetCol = anchorCol + ci;
                    if (targetCol >= self._colCount()) continue;

                    var rawVal = pastedRows[ri][ci].trim();
                    var isNumeric = (self._mode === 'cartesian' && targetCol > 0) ||
                                   (self._mode === 'pie' && targetCol === 1) ||
                                   (self._mode === 'scatter' && targetCol > 0);
                    if (isNumeric) {
                        var n = parseFloat(rawVal);
                        rawVal = isNaN(n) ? '' : String(n);
                    }
                    self._rows[targetRow][targetCol] = rawVal;
                }
            }

            // Full re-render to reflect all changes
            var refocusRow = anchorRow;
            var refocusCol = anchorCol;
            self._renderAll(refocusRow, refocusCol);
            self._scheduleChange();
        });

        // Clicks (delegated via data-cte-action)
        this._wrap.addEventListener('click', function (e) {
            var actionEl = e.target.closest
                ? e.target.closest('[data-cte-action]')
                : null;
            if (!actionEl) return;

            var action = actionEl.getAttribute('data-cte-action');

            if (action === 'add-row') {
                self._addRow();
            } else if (action === 'add-series') {
                self._addSeries();
            } else if (action === 'delete-row') {
                self._deleteRow(parseInt(actionEl.getAttribute('data-cte-row'), 10));
            } else if (action === 'delete-series') {
                self._deleteSeries(parseInt(actionEl.getAttribute('data-cte-col'), 10));
            }
        });

        // Double-click on editable column header → rename (ignore clicks on the color swatch)
        this._wrap.addEventListener('dblclick', function (e) {
            if (e.target.closest && e.target.closest('.cte-th__color')) return;
            var th = e.target.closest ? e.target.closest('th.cte-th--editable') : null;
            if (!th) return;
            var colIdx = parseInt(th.getAttribute('data-cte-col'), 10);
            self._startHeaderRename(colIdx, th);
        });
    };

    // -------------------------------------------------------------------------
    // Header rename
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._startHeaderRename = function (colIdx, th) {
        var self     = this;
        var label    = th.querySelector('.cte-th__label');
        if (!label) return;

        var origName = this._headers[colIdx];

        var renameInput = document.createElement('input');
        renameInput.type = 'text';
        renameInput.className = 'cte-th__rename-input';
        renameInput.value = origName;
        renameInput.setAttribute('data-cte-col', colIdx);

        label.replaceWith(renameInput);
        renameInput.focus();
        renameInput.select();

        renameInput.addEventListener('blur', function () {
            var cancelled = renameInput.dataset.cteCancelled === '1';
            var newName   = cancelled ? origName : renameInput.value.trim();
            self._headers[colIdx] = newName;

            var newLabel = document.createElement('span');
            newLabel.className = 'cte-th__label';
            newLabel.textContent = newName;
            renameInput.replaceWith(newLabel);

            if (!cancelled) self._scheduleChange();
        });
    };

    // -------------------------------------------------------------------------
    // Row management
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._addRow = function () {
        this._addRowQuiet();
        this._renderAll();
        this._scheduleChange();
    };

    ChartTableEditor.prototype._addRowQuiet = function () {
        var row = [];
        for (var c = 0; c < this._colCount(); c++) {
            if (this._mode === 'pie' && c === 2 && this._allowColors) {
                row.push(this._color(this._rows.length));
            } else {
                row.push('');
            }
        }
        this._rows.push(row);
    };

    ChartTableEditor.prototype._deleteRow = function (rowIdx) {
        if (this._rows.length <= 1) return;
        this._rows.splice(rowIdx, 1);
        this._renderAll();
        this._scheduleChange();
    };

    // -------------------------------------------------------------------------
    // Series (column) management — cartesian only
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype._addSeries = function () {
        this._addSeriesQuiet();
        this._renderAll();
        this._scheduleChange();
    };

    ChartTableEditor.prototype._addSeriesQuiet = function () {
        var idx      = this._headers.length - 1; // how many series exist before adding
        var newName  = 'Series ' + (idx + 1);
        var newColor = this._color(idx);
        this._headers.push(newName);
        this._colors.push(newColor);
        this._seriesTypes.push('');
        this._yAxisIndices.push(0);
        this._rows.forEach(function (row) { row.push(''); });
    };

    ChartTableEditor.prototype._deleteSeries = function (colIdx) {
        var seriesCount = this._headers.length - 1; // exclude Category
        if (colIdx === 0 || seriesCount <= 1) return; // can't delete Category or last series

        this._headers.splice(colIdx, 1);
        this._colors.splice(colIdx, 1);
        this._seriesTypes.splice(colIdx, 1);
        this._yAxisIndices.splice(colIdx, 1);
        this._rows.forEach(function (row) { row.splice(colIdx, 1); });
        this._renderAll();
        this._scheduleChange();
    };

    ChartTableEditor.prototype.setYAxisCount = function (n) {
        this._yAxisCount = Math.max(1, n);
        // Clamp any indices that are now out of range
        this._yAxisIndices = this._yAxisIndices.map(function (idx) {
            return idx === null ? null : Math.min(idx || 0, n - 1);
        });
        this._renderHeader();
    };

    // -------------------------------------------------------------------------
    // Public API: setData / getData / destroy
    // -------------------------------------------------------------------------
    ChartTableEditor.prototype.setData = function (data) {
        if (this._mode === 'pie') {
            this._headers = ['Label', 'Value', 'Color'];
            this._colors  = [null, null, null];
            var slices = (data.series && data.series[0] && data.series[0].data)
                ? data.series[0].data : [];
            this._rows = slices.map(function (sl, i) {
                return [
                    String(sl.name  || ''),
                    String(sl.value || ''),
                    sl.color || this._color(i),
                ];
            }, this);
            while (this._rows.length < 3) {
                this._rows.push(['', '', this._color(this._rows.length)]);
            }

        } else if (this._mode === 'scatter') {
            this._headers = ['Series', 'X', 'Y'];
            this._colors  = [null, null, null];
            this._rows    = [];
            (data.series || []).forEach(function (sr) {
                (sr.data || []).forEach(function (pt) {
                    var x = Array.isArray(pt) ? pt[0] : (pt.x !== undefined ? pt.x : '');
                    var y = Array.isArray(pt) ? pt[1] : (pt.y !== undefined ? pt.y : '');
                    this._rows.push([sr.name || '', String(x), String(y)]);
                }, this);
            }, this);
            while (this._rows.length < 3) this._rows.push(['', '', '']);

        } else {
            // cartesian
            var categories = data.categories || [];
            var series     = data.series || [];

            this._headers = ['Category'].concat(series.map(function (s, i) {
                return s.name || ('Series ' + (i + 1));
            }));
            this._colors = [null].concat(series.map(function (s, i) {
                return s.color || this._color(i);
            }, this));
            this._seriesTypes = [null].concat(series.map(function (s) {
                return s.type || '';
            }));
            this._yAxisIndices = [null].concat(series.map(function (s) {
                return typeof s.yAxisIndex === 'number' ? s.yAxisIndex : 0;
            }));

            if (this._headers.length === 1) {
                // No series yet — add a blank one with a default name
                this._headers.push('Series 1');
                this._colors.push(this._color(0));
                this._seriesTypes.push('');
            }

            var numRows = series.reduce(function (mx, s) {
                return Math.max(mx, (s.data || []).length);
            }, categories.length);
            numRows = Math.max(numRows, 3);

            this._rows = [];
            for (var i = 0; i < numRows; i++) {
                var row = [i < categories.length ? String(categories[i]) : ''];
                series.forEach(function (s) {
                    var v = (s.data || [])[i];
                    row.push(v !== null && v !== undefined ? String(v) : '');
                });
                // If no series existed, add empty value column
                if (series.length === 0) row.push('');
                this._rows.push(row);
            }
        }

        this._renderAll();
    };

    ChartTableEditor.prototype.getData = function () {
        if (this._mode === 'pie') {
            var slices = [];
            this._rows.forEach(function (row, i) {
                var name = String(row[0] || '').trim();
                var val  = parseFloat(row[1]);
                if (!name && !(val > 0)) return; // skip completely empty rows
                var slice = { name: name, value: isNaN(val) ? 0 : val };
                var color = String(row[2] || '').trim();
                if (color) slice.color = color;
                slices.push(slice);
            });
            return { series: [{ name: 'Pie', data: slices }] };
        }

        if (this._mode === 'scatter') {
            var groups = {};
            var order  = [];
            this._rows.forEach(function (row) {
                var name = String(row[0] || '').trim() || 'Series';
                var x = parseFloat(row[1]);
                var y = parseFloat(row[2]);
                if (isNaN(x) || isNaN(y)) return;
                if (!groups[name]) { groups[name] = []; order.push(name); }
                groups[name].push([x, y]);
            });
            return {
                series: order.map(function (name) {
                    return { name: name, data: groups[name] };
                })
            };
        }

        // cartesian — strip completely empty rows first
        var dataRows = this._rows.filter(function (row) {
            return row.some(function (c) { return String(c || '').trim() !== ''; });
        });

        var self     = this;
        var seriesCols = this._headers.slice(1); // exclude Category

        return {
            categories: dataRows.map(function (row) { return String(row[0] || '').trim(); }),
            series: seriesCols.map(function (name, j) {
                var colIdx = j + 1;
                var entry = {
                    name:  name || '',
                    color: self._colors[colIdx] || self._color(j),
                    data:  dataRows.map(function (row) {
                        var v = parseFloat(row[colIdx]);
                        return isNaN(v) ? null : v;
                    }).filter(function (v) { return v !== null; }),
                };
                if (self._allowSeriesTypes) {
                    var seriesType = self._seriesTypes[colIdx] || '';
                    if (seriesType) entry.type = seriesType;
                }
                var yAxisIdx = self._yAxisIndices[colIdx] || 0;
                if (yAxisIdx > 0) entry.yAxisIndex = yAxisIdx;
                return entry;
            }),
        };
    };

    ChartTableEditor.prototype.destroy = function () {
        clearTimeout(this._changeTimer);
        if (this._container) this._container.innerHTML = '';
        this._container = null;
        this._wrap      = null;
        this._thead     = null;
        this._tbody     = null;
    };

    // -------------------------------------------------------------------------
    // Export
    // -------------------------------------------------------------------------
    global.ChartTableEditor = ChartTableEditor;

}(window));
