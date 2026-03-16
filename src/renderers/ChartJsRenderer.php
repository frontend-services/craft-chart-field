<?php

namespace chartfield\renderers;

use chartfield\models\ChartData;
use craft\helpers\Json;

class ChartJsRenderer implements ChartRendererInterface
{
    public function getHandle(): string
    {
        return 'chartjs';
    }

    public function getName(): string
    {
        return 'Chart.js';
    }

    public function isCommercial(): bool
    {
        return false;
    }

    public function getSupportedTypes(): array
    {
        return ['line', 'bar', 'column', 'pie', 'doughnut', 'donut', 'radar', 'scatter', 'polar-area', 'stacked-bar', 'stacked-column', 'area'];
    }

    public function getDefaultJsAssets(): array
    {
        return ['https://cdn.jsdelivr.net/npm/chart.js'];
    }

    public function buildConfig(ChartData $data, ?string $licenseKey = null): array
    {
        $chartType = $data->chartType ?? 'line';
        $type = $this->mapChartType($chartType);
        $isPolar = in_array($chartType, ['pie', 'donut', 'doughnut', 'radar', 'polar-area']);

        $config = [
            'type' => $type,
            'data' => [
                'labels' => $this->extractLabels($data),
                'datasets' => $this->buildDatasets($data),
            ],
            'options' => [
                'responsive' => $data->responsive,
                'plugins' => [
                    'title' => [
                        'display' => !empty($data->title),
                        'text' => $data->title ?? '',
                    ],
                    'subtitle' => [
                        'display' => !empty($data->subtitle),
                        'text' => $data->subtitle ?? '',
                    ],
                    'legend' => [
                        'display' => $data->legend['enabled'] ?? true,
                        'position' => $data->legend['position'] ?? 'bottom',
                    ],
                    'tooltip' => [
                        'enabled' => $data->tooltip['enabled'] ?? true,
                        'mode' => ($data->tooltip['shared'] ?? false) ? 'index' : 'nearest',
                    ],
                ],
            ],
        ];

        if (!$isPolar) {
            $isHorizontalBar = $chartType === 'bar';
            $config['options']['indexAxis'] = $isHorizontalBar ? 'y' : 'x';

            $config['options']['scales'] = [
                'x' => [
                    'title' => [
                        'display' => !empty($data->xAxis['label'] ?? null),
                        'text' => $data->xAxis['label'] ?? '',
                    ],
                    'stacked' => $data->stacking,
                ],
                'y' => [
                    'title' => [
                        'display' => !empty($data->yAxis['label'] ?? null),
                        'text' => $data->yAxis['label'] ?? '',
                    ],
                    'stacked' => $data->stacking,
                ],
            ];

            if (isset($data->yAxis['min'])) {
                $config['options']['scales']['y']['min'] = $data->yAxis['min'];
            }
            if (isset($data->yAxis['max'])) {
                $config['options']['scales']['y']['max'] = $data->yAxis['max'];
            }
            if (!empty($data->yAxis['suffix'])) {
                $config['_yAxisSuffix'] = $data->yAxis['suffix'];
            }
        }

        // Store prefix/suffix as private keys for use in renderHtml()
        // (Chart.js requires JS functions for formatters — can't go in JSON)
        if ($data->valuePrefix !== null && $data->valuePrefix !== '') {
            $config['_valuePrefix'] = $data->valuePrefix;
        }
        if ($data->valueSuffix !== null && $data->valueSuffix !== '') {
            $config['_valueSuffix'] = $data->valueSuffix;
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

        // Extract and remove private keys before JSON serialization
        $prefix = $config['_valuePrefix'] ?? '';
        $suffix = $config['_valueSuffix'] ?? '';
        $yAxisSuffix = $config['_yAxisSuffix'] ?? '';
        unset($config['_valuePrefix'], $config['_valueSuffix'], $config['_yAxisSuffix']);

        $jsonConfig = Json::encode($config);

        $html = sprintf(
            '<canvas id="%s" style="width:%s;height:%s;" class="%s"></canvas>',
            htmlspecialchars($containerId),
            htmlspecialchars($width),
            htmlspecialchars($height),
            htmlspecialchars($class)
        );

        $formatterJs = '';
        if ($prefix !== '' || $suffix !== '' || $yAxisSuffix !== '') {
            $p  = json_encode($prefix);
            $s  = json_encode($suffix);
            $ys = json_encode($yAxisSuffix);
            $formatterJs = <<<JS
var _p={$p},_s={$s},_ys={$ys};
config.options=config.options||{};
config.options.plugins=config.options.plugins||{};
if(_p||_s){
config.options.plugins.tooltip=config.options.plugins.tooltip||{};
config.options.plugins.tooltip.callbacks={
    label:function(ctx){
        var val=ctx.parsed&&ctx.parsed.y!==undefined?ctx.parsed.y:(typeof ctx.parsed==='number'?ctx.parsed:ctx.formattedValue);
        var lbl=ctx.dataset?ctx.dataset.label||'':'';
        return (lbl?lbl+': ':'')+_p+val+_s;
    }
};}
if(_ys){
config.options.scales=config.options.scales||{};
config.options.scales.y=config.options.scales.y||{};
config.options.scales.y.ticks=config.options.scales.y.ticks||{};
config.options.scales.y.ticks.callback=function(val){return val+_ys;};}
JS;
        }

        $html .= sprintf(
            '<script>(function(){var el=document.getElementById(%s);if(!el)return;var config=%s;%snew Chart(el,config);})();</script>',
            json_encode($containerId),
            $jsonConfig,
            $formatterJs
        );

        return $html;
    }

    // --- Private helpers ---

    private function mapChartType(string $type): string
    {
        return match ($type) {
            'bar', 'column', 'stacked-bar', 'stacked-column' => 'bar',
            'donut', 'doughnut' => 'doughnut',
            'area', 'stacked-area' => 'line',
            'polar-area' => 'polarArea',
            default => $type,
        };
    }

    private function extractLabels(ChartData $data): array
    {
        $isPieType = in_array($data->chartType ?? '', ['pie', 'donut', 'doughnut']);

        if ($isPieType) {
            $series = $data->series[0] ?? [];
            return array_column($series['data'] ?? [], 'name');
        }

        return $data->xAxis['categories'] ?? [];
    }

    private function buildDatasets(ChartData $data): array
    {
        $isPieType = in_array($data->chartType ?? '', ['pie', 'donut', 'doughnut']);
        $isArea = in_array($data->chartType ?? '', ['area', 'stacked-area']);
        $datasets = [];

        if ($isPieType) {
            $series = $data->series[0] ?? [];
            $values = array_column($series['data'] ?? [], 'value');
            $colors = array_column($series['data'] ?? [], 'color');

            if (empty($colors)) {
                $palette = $data->colors ?? $this->defaultColors();
                $colors = array_slice($palette, 0, count($values));
            }

            $datasets[] = [
                'data' => $values,
                'backgroundColor' => $colors,
            ];

            return $datasets;
        }

        foreach ($data->series as $index => $series) {
            $palette = $data->colors ?? $this->defaultColors();
            $color = $series['color'] ?? ($palette[$index % count($palette)] ?? '#4A90D9');

            $dataset = [
                'label' => $series['name'] ?? '',
                'data' => $series['data'] ?? [],
                'backgroundColor' => $isArea ? $this->hexToRgba($color, 0.2) : $color,
                'borderColor' => $color,
                'borderWidth' => 2,
            ];

            if ($isArea) {
                $dataset['fill'] = true;
            }

            $datasets[] = $dataset;
        }

        return $datasets;
    }

    private function defaultColors(): array
    {
        return ['#4A90D9', '#D94A4A', '#50C878', '#FFB347', '#9B59B6', '#1ABC9C', '#E67E22', '#34495E'];
    }

    private function hexToRgba(string $hex, float $alpha): string
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));
        return "rgba($r,$g,$b,$alpha)";
    }
}
