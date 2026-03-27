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
        $isCombo = $this->isComboMode($data);
        // In combo mode, Chart.js requires 'bar' as the chart-level type so that
        // both bar/column and line datasets share the same category axis correctly.
        $type = $isCombo ? 'bar' : $this->mapChartType($chartType);
        $isPolar = in_array($chartType, ['pie', 'donut', 'doughnut', 'radar', 'polar-area']);

        $config = [
            'type' => $type,
            'data' => [
                'labels' => $this->extractLabels($data),
                'datasets' => $this->buildDatasets($data, $isCombo),
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
            $isHorizontalBar = !$isCombo && $chartType === 'bar';
            $config['options']['indexAxis'] = $isHorizontalBar ? 'y' : 'x';

            $yAxes = $data->getResolvedYAxes();

            $config['options']['scales'] = [
                'x' => [
                    'title'   => [
                        'display' => !empty($data->xAxis['label'] ?? null),
                        'text'    => $data->xAxis['label'] ?? '',
                    ],
                    'stacked' => $data->stacking,
                ],
            ];

            foreach ($yAxes as $idx => $ax) {
                $scaleId = $idx === 0 ? 'y' : 'y' . $idx;
                $scale   = [
                    'title'    => [
                        'display' => !empty($ax['label'] ?? null),
                        'text'    => $ax['label'] ?? '',
                    ],
                    'stacked'  => $data->stacking,
                    'position' => $idx > 0 ? 'right' : 'left',
                ];
                if (isset($ax['min']) && $ax['min'] !== null) $scale['min'] = $ax['min'];
                if (isset($ax['max']) && $ax['max'] !== null) $scale['max'] = $ax['max'];
                $config['options']['scales'][$scaleId] = $scale;
            }

            // Pass per-axis formatters to renderHtml() via private key
            $formatters = array_map(fn($ax) => [
                'prefix' => $ax['prefix'] ?? '',
                'suffix' => $ax['suffix'] ?? '',
            ], $yAxes);

            $hasFormatters = !empty(array_filter($formatters, fn($f) => $f['prefix'] !== '' || $f['suffix'] !== ''));
            if ($hasFormatters) {
                $config['_yAxesFormatters'] = array_values($formatters);
            }
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

        $yAxesFormatters = $config['_yAxesFormatters'] ?? [];
        unset($config['_yAxesFormatters']);

        $jsonConfig = Json::encode($config);

        $html = sprintf(
            '<canvas id="%s" style="width:%s;height:%s;" class="%s"></canvas>',
            htmlspecialchars($containerId),
            htmlspecialchars($width),
            htmlspecialchars($height),
            htmlspecialchars($class)
        );

        $formatterJs = '';
        if (!empty($yAxesFormatters)) {
            $fmtJson  = json_encode(array_values($yAxesFormatters));
            $scaleMap = [];
            foreach ($yAxesFormatters as $idx => $_) {
                $scaleMap[$idx === 0 ? 'y' : 'y' . $idx] = $idx;
            }
            $scaleMapJson = json_encode($scaleMap);
            $formatterJs  = <<<JS
var _axFmt={$fmtJson},_scMap={$scaleMapJson};
config.options=config.options||{};
config.options.scales=config.options.scales||{};
Object.keys(_scMap).forEach(function(sid){
  var ai=_scMap[sid],f=_axFmt[ai]||{prefix:'',suffix:''};
  if(f.prefix||f.suffix){
    config.options.scales[sid]=config.options.scales[sid]||{};
    config.options.scales[sid].ticks=config.options.scales[sid].ticks||{};
    (function(p,s){config.options.scales[sid].ticks.callback=function(val){return p+val+s;};})(f.prefix||'',f.suffix||'');
  }
});
config.options.plugins=config.options.plugins||{};
config.options.plugins.tooltip=config.options.plugins.tooltip||{};
config.options.plugins.tooltip.callbacks={
  label:function(ctx){
    var aid=ctx.dataset&&ctx.dataset.yAxisID?ctx.dataset.yAxisID:'y';
    var ai=_scMap[aid]!==undefined?_scMap[aid]:0;
    var f=_axFmt[ai]||{prefix:'',suffix:''};
    var val=ctx.parsed&&ctx.parsed.y!==undefined?ctx.parsed.y:(typeof ctx.parsed==='number'?ctx.parsed:ctx.formattedValue);
    var lbl=ctx.dataset?ctx.dataset.label||'':'';
    return(lbl?lbl+': ':'')+( f.prefix||'')+val+(f.suffix||'');
  }
};
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
        $isPieType = in_array($data->chartType ?? 'line', ['pie', 'donut', 'doughnut']);

        if ($isPieType) {
            $series = $data->series[0] ?? [];
            return array_column($series['data'] ?? [], 'name');
        }

        return $data->xAxis['categories'] ?? [];
    }

    private function isComboMode(ChartData $data): bool
    {
        $globalType = $data->chartType ?? 'line';
        foreach ($data->series as $s) {
            if (!empty($s['type']) && $s['type'] !== $globalType) {
                return true;
            }
        }
        return false;
    }

    private function buildDatasets(ChartData $data, bool $isCombo = false): array
    {
        $yAxes = $data->getResolvedYAxes();
        $globalType = $data->chartType ?? 'line';
        $isPieType = in_array($globalType, ['pie', 'donut', 'doughnut']);
        $isArea = in_array($globalType, ['area', 'stacked-area']);
        $datasets = [];

        if ($isPieType) {
            $series = $data->series[0] ?? [];
            $values = array_column($series['data'] ?? [], 'value');
            $rawColors = array_column($series['data'] ?? [], 'color');
            $colors = array_map(fn($c) => ChartData::sanitizeColor($c) ?? '#4A90D9', $rawColors);

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
            $rawColor = $series['color'] ?? ($palette[$index % count($palette)] ?? '#4A90D9');
            $color = ChartData::sanitizeColor($rawColor) ?? ($palette[$index % count($palette)] ?? '#4A90D9');

            // Resolve effective type for this series
            $seriesType = !empty($series['type']) ? $series['type'] : $globalType;
            $isSeriesArea = in_array($seriesType, ['area', 'stacked-area']);

            $dataset = [
                'label' => $series['name'] ?? '',
                'data' => $series['data'] ?? [],
                'backgroundColor' => ($isArea || $isSeriesArea) ? $this->hexToRgba($color, 0.2) : $color,
                'borderColor' => $color,
                'borderWidth' => 2,
            ];

            if ($isArea || $isSeriesArea) {
                $dataset['fill'] = true;
            }

            if ($isCombo) {
                $dataset['type'] = $isSeriesArea ? 'line' : $this->mapChartType($seriesType);
            }

            // Assign dataset to its Y axis scale
            $yAxisIndex = (int)($series['yAxisIndex'] ?? 0);
            $dataset['yAxisID'] = $yAxisIndex === 0 ? 'y' : 'y' . $yAxisIndex;

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
