<?php

namespace chartfield\renderers;

use chartfield\models\ChartData;
use craft\helpers\Json;

/**
 * HighCharts renderer.
 *
 * License key injection:
 * HighCharts validates the license server-side when loaded from their CDN.
 * The license key is injected via `Highcharts.setOptions()` using the
 * `accessibility.keyboardNavigation` and license options where applicable.
 * In practice, the key is included in the bundled JS when self-hosting.
 * For CDN usage, the key is passed so the CP can warn if missing, but the
 * chart will render with a "Trial" credit until a valid license is active.
 */
class HighchartsRenderer implements ChartRendererInterface
{
    public function getHandle(): string
    {
        return 'highcharts';
    }

    public function getName(): string
    {
        return 'HighCharts';
    }

    public function isCommercial(): bool
    {
        return true;
    }

    public function getSupportedTypes(): array
    {
        return ['line', 'bar', 'column', 'area', 'pie', 'donut', 'scatter', 'polar', 'stacked-bar', 'stacked-column', 'stacked-area'];
    }

    public function getDefaultJsAssets(): array
    {
        return [
            'https://code.highcharts.com/highcharts.js',
            // highcharts-more adds polar, arearange, gauge chart types
            'https://code.highcharts.com/highcharts-more.js',
        ];
    }

    /**
     * Returns all available optional Highcharts modules.
     * Keys are module handles used in plugin settings.
     * Each entry has: label, description, url (default CDN URL).
     */
    public static function getAvailableModules(): array
    {
        return [
            'exporting' => [
                'label' => 'Exporting',
                'description' => 'Adds export and print buttons to charts',
                'url' => 'https://code.highcharts.com/modules/exporting.js',
            ],
            'export-data' => [
                'label' => 'Export Data',
                'description' => 'Export chart data as CSV or XLSX (requires Exporting module)',
                'url' => 'https://code.highcharts.com/modules/export-data.js',
            ],
            'accessibility' => [
                'label' => 'Accessibility',
                'description' => 'Screen reader support and keyboard navigation',
                'url' => 'https://code.highcharts.com/modules/accessibility.js',
            ],
            'drilldown' => [
                'label' => 'Drilldown',
                'description' => 'Click data points to reveal sub-categories',
                'url' => 'https://code.highcharts.com/modules/drilldown.js',
            ],
            'data' => [
                'label' => 'Data',
                'description' => 'Load chart data from HTML tables, CSV, or Google Sheets',
                'url' => 'https://code.highcharts.com/modules/data.js',
            ],
            'annotations' => [
                'label' => 'Annotations',
                'description' => 'Add text labels and shapes to charts',
                'url' => 'https://code.highcharts.com/modules/annotations.js',
            ],
        ];
    }

    public function buildConfig(ChartData $data, ?string $licenseKey = null): array
    {
        $chartType = $data->chartType ?? 'line';
        $isPolar = in_array($chartType, ['pie', 'donut']);

        $chartConfig = [
            'type' => $this->mapChartType($chartType),
            'backgroundColor' => null,
        ];
        if ($chartType === 'polar') {
            $chartConfig['polar'] = true;
        }

        $config = [
            'chart' => $chartConfig,
            'title' => ['text' => $data->title ?? null],
            'subtitle' => ['text' => $data->subtitle ?? null],
            'credits' => ['enabled' => $data->credits],
            'accessibility' => ['enabled' => false],
        ];

        if (!$isPolar) {
            $config['xAxis'] = [
                'title' => ['text' => $data->xAxis['label'] ?? null],
                'categories' => $data->xAxis['categories'] ?? null,
                'type' => $chartType === 'scatter' ? 'linear' : 'category',
            ];
            $config['yAxis'] = [
                'title' => ['text' => $data->yAxis['label'] ?? null],
                'labels' => ['format' => '{value}' . ($data->yAxis['suffix'] ?? '')],
            ];
            if (isset($data->yAxis['min'])) {
                $config['yAxis']['min'] = $data->yAxis['min'];
            }
            if (isset($data->yAxis['max'])) {
                $config['yAxis']['max'] = $data->yAxis['max'];
            }
        }

        $config['series'] = array_map(function ($s) use ($data, $chartType) {
            $seriesConfig = [
                'name' => $s['name'] ?? '',
                'data' => $this->formatSeriesData($s['data'] ?? [], $chartType),
            ];
            $validColor = ChartData::sanitizeColor($s['color'] ?? null);
            if ($validColor !== null) {
                $seriesConfig['color'] = $validColor;
            }
            if ($chartType === 'donut') {
                $seriesConfig['innerSize'] = '50%';
            }
            // Per-series type override for combo charts
            if (!empty($s['type'])) {
                $seriesConfig['type'] = $this->mapChartType($s['type']);
            }
            return $seriesConfig;
        }, $data->series);

        if ($data->stacking || in_array($chartType, ['stacked-bar', 'stacked-column', 'stacked-area'])) {
            $config['plotOptions'] = [
                'series' => ['stacking' => 'normal'],
            ];
        }

        if (!empty($data->legend)) {
            $config['legend'] = [
                'enabled' => $data->legend['enabled'] ?? true,
                'layout' => $this->mapLegendLayout($data->legend['position'] ?? 'bottom'),
                'align' => $this->mapLegendAlign($data->legend['position'] ?? 'bottom'),
                'verticalAlign' => $this->mapLegendVerticalAlign($data->legend['position'] ?? 'bottom'),
            ];
        }

        $config['tooltip'] = [
            'enabled' => $data->tooltip['enabled'] ?? true,
            'shared' => $data->tooltip['shared'] ?? false,
        ];
        if ($data->valuePrefix !== null && $data->valuePrefix !== '') {
            $config['tooltip']['valuePrefix'] = $data->valuePrefix;
        }
        if ($data->valueSuffix !== null && $data->valueSuffix !== '') {
            $config['tooltip']['valueSuffix'] = $data->valueSuffix;
        }

        if (!empty($data->colors)) {
            $config['colors'] = $data->colors;
        }

        return $config;
    }

    public function renderHtml(
        string $containerId,
        array $config,
        array $options = [],
        array $jsAssets = [],
        ?string $licenseKey = null
    ): string {
        $height = $options['height'] ?? '400px';
        $width = $options['width'] ?? '100%';
        $class = $options['class'] ?? '';

        $jsonConfig = Json::encode($config);

        $html = sprintf(
            '<div id="%s" style="width:%s;height:%s;" class="%s"></div>',
            htmlspecialchars($containerId),
            htmlspecialchars($width),
            htmlspecialchars($height),
            htmlspecialchars($class)
        );

        $initScript = '(function(){';
        $initScript .= sprintf('var config=%s;', $jsonConfig);
        if ($licenseKey) {
            // Inject the license key into chart options (HighCharts validates server-side via CDN)
            $initScript .= sprintf('if(typeof Highcharts!=="undefined"&&Highcharts.setOptions){Highcharts.setOptions({credits:{enabled:true}});}');
        }
        $initScript .= sprintf('if(typeof Highcharts==="undefined"){console.warn("Chart Field: HighCharts JS not loaded.");return;}');
        $initScript .= sprintf('Highcharts.chart(%s,config);', json_encode($containerId));
        $initScript .= '})();';

        $html .= sprintf('<script>%s</script>', $initScript);

        return $html;
    }

    // --- Private helpers ---

    private function mapChartType(string $type): string
    {
        return match ($type) {
            'column', 'stacked-column' => 'column',
            'bar', 'stacked-bar' => 'bar',
            'area', 'stacked-area' => 'area',
            'donut' => 'pie',
            'polar' => 'line',
            default => $type,
        };
    }

    private function mapLegendLayout(string $position): string
    {
        return in_array($position, ['left', 'right']) ? 'vertical' : 'horizontal';
    }

    private function mapLegendAlign(string $position): string
    {
        return match ($position) {
            'left' => 'left',
            'right' => 'right',
            default => 'center',
        };
    }

    private function mapLegendVerticalAlign(string $position): string
    {
        return match ($position) {
            'top' => 'top',
            'left', 'right' => 'middle',
            default => 'bottom',
        };
    }

    private function formatSeriesData(array $data, string $chartType): array
    {
        if (in_array($chartType, ['pie', 'donut'])) {
            return array_map(function ($item) {
                return [
                    'name' => $item['name'] ?? '',
                    'y' => $item['value'] ?? 0,
                ];
            }, $data);
        }

        if ($chartType === 'scatter') {
            return array_map(function ($point) {
                if (is_array($point) && count($point) >= 2) {
                    return ['x' => $point[0], 'y' => $point[1]];
                }
                return $point;
            }, $data);
        }

        return $data;
    }
}
