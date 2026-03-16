/**
 * Chart Field — Field Settings JS
 * Manages the admin-side field configuration panel behaviour.
 */
(function () {
    'use strict';

    var SUPPORTED_TYPES = {
        chartjs: ['line', 'bar', 'column', 'pie', 'doughnut', 'donut', 'radar', 'scatter', 'polar-area', 'stacked-bar', 'stacked-column', 'area'],
        highcharts: ['line', 'bar', 'column', 'area', 'pie', 'donut', 'scatter', 'polar', 'stacked-bar', 'stacked-column', 'stacked-area'],
        apexcharts: ['line', 'bar', 'column', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'radar', 'stacked-bar', 'stacked-column', 'stacked-area'],
    };

    var TYPE_LABELS = {
        line: 'Line',
        bar: 'Bar (Horizontal)',
        column: 'Column (Vertical)',
        area: 'Area',
        pie: 'Pie',
        donut: 'Donut',
        doughnut: 'Doughnut',
        scatter: 'Scatter',
        radar: 'Radar',
        polar: 'Polar',
        'polar-area': 'Polar Area',
        heatmap: 'Heatmap',
        'stacked-bar': 'Stacked Bar',
        'stacked-column': 'Stacked Column',
        'stacked-area': 'Stacked Area',
    };

    var COMMERCIAL_LIBRARIES = ['highcharts'];

    function init() {
        var wrapper = document.querySelector('.chart-field-field-settings');
        if (!wrapper) return;

        var licenseKeys = {};
        try {
            licenseKeys = JSON.parse(wrapper.getAttribute('data-has-license-keys') || '{}');
        } catch (e) {}

        var librarySelect = wrapper.querySelector('[name$="[chartLibrary]"], select#chartLibrary, select[name="chartLibrary"]');
        var grid = wrapper.querySelector('#allowedChartTypesGrid, .chart-field-type-checkboxes__grid');

        if (!librarySelect || !grid) return;

        // Update checkboxes when library changes
        librarySelect.addEventListener('change', function () {
            updateCheckboxes(librarySelect.value, grid, wrapper);
            updateLicenseWarning(librarySelect.value, licenseKeys, wrapper);
        });
    }

    function updateCheckboxes(library, grid, wrapper) {
        var supported = SUPPORTED_TYPES[library] || [];

        // Read current selections AND capture the actual (namespaced) input name
        var currentChecked = [];
        var inputName = 'allowedChartTypes[]'; // fallback
        grid.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            inputName = cb.name; // Craft may namespace this — preserve it
            if (cb.checked) {
                currentChecked.push(cb.value);
            }
        });

        // Rebuild checkboxes for the new library using the same namespaced name
        grid.innerHTML = '';
        supported.forEach(function (type) {
            var label = document.createElement('label');
            label.className = 'chart-field-type-checkbox';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.name = inputName;
            cb.value = type;
            // Re-check if it was checked before and is still supported
            if (currentChecked.indexOf(type) !== -1) {
                cb.checked = true;
            }

            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + (TYPE_LABELS[type] || type)));
            grid.appendChild(label);
        });
    }

    function updateLicenseWarning(library, licenseKeys, wrapper) {
        var isCommercial = COMMERCIAL_LIBRARIES.indexOf(library) !== -1;
        var hasKey = !!(licenseKeys[library]);

        // Remove existing warning if any
        var existing = wrapper.querySelector('.chart-field-license-warning');
        if (existing) {
            existing.remove();
        }

        if (isCommercial && !hasKey) {
            var warning = document.createElement('div');
            warning.className = 'chart-field-license-warning';
            warning.innerHTML = '&#9888; No license key configured for ' + library + '. ' +
                '<a href="">Add one in plugin settings.</a>';

            var selectField = wrapper.querySelector('[name$="[chartLibrary]"], select#chartLibrary');
            if (selectField) {
                var container = selectField.closest('.field') || selectField.parentElement;
                container.parentElement.insertBefore(warning, container.nextSibling);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Handle Craft's element editor & slideouts that inject content after load
    if (typeof Garnish !== 'undefined') {
        Garnish.on(Garnish.Base, 'init', function () {
            init();
        });
    }

})();
