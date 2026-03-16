<?php

namespace chartfield\renderers;

use chartfield\models\ChartData;
use craft\helpers\Json;

class ApexChartsRenderer implements ChartRendererInterface
{
    public function getHandle(): string
    {
        return 'apexcharts';
    }

    public function getName(): string
    {
        return 'ApexCharts';
    }

    public function isCommercial(): bool
    {
        return false;
    }

    public function getSupportedTypes(): array
    {
        return ['line', 'bar', 'column', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'radar', 'stacked-bar', 'stacked-column', 'stacked-area'];
    }

    public function getDefaultJsAssets(): array
    {
        return ['https://cdn.jsdelivr.net/npm/apexcharts'];
    }

    public function buildConfig(ChartData $data, ?string $licenseKey = null): array
    {
        $chartType = $data->chartType ?? 'line';
        $isPolar = in_array($chartType, ['pie', 'donut']);
        $isStacked = in_array($chartType, ['stacked-bar', 'stacked-column', 'stacked-area']) || $data->stacking;

        $config = [
            'chart' => [
                'type' => $this->mapChartType($chartType),
                'height' => '100%',
                'width' => '100%',
                'toolbar' => ['show' => false],
            ],
            'title' => [
                'text' => $data->title ?? '',
                'align' => 'left',
            ],
            'subtitle' => [
                'text' => $data->subtitle ?? '',
                'align' => 'left',
            ],
        ];

        if ($isStacked) {
            $config['chart']['stacked'] = true;
        }

        if ($isPolar) {
            $firstSeries = $data->series[0] ?? [];
            $config['series'] = array_column($firstSeries['data'] ?? [], 'value');
            $config['labels'] = array_column($firstSeries['data'] ?? [], 'name');
        } else {
            $config['series'] = array_map(function ($s) {
                return [
                    'name' => $s['name'] ?? '',
                    'data' => $s['data'] ?? [],
                ];
            }, $data->series);

            $config['xaxis'] = [
                'title' => ['text' => $data->xAxis['label'] ?? ''],
                'categories' => $data->xAxis['categories'] ?? [],
                'type' => $chartType === 'scatter' ? 'numeric' : 'category',
            ];

            $config['yaxis'] = [
                'title' => ['text' => $data->yAxis['label'] ?? ''],
            ];

            if (isset($data->yAxis['min'])) {
                $config['yaxis']['min'] = $data->yAxis['min'];
            }
            if (isset($data->yAxis['max'])) {
                $config['yaxis']['max'] = $data->yAxis['max'];
            }
            if (!empty($data->yAxis['suffix'])) {
                // Store as private key; renderHtml() injects it as a proper JS function via json_encode
                $config['_yAxisSuffix'] = $data->yAxis['suffix'];
            }
        }

        if (!empty($data->colors)) {
            $config['colors'] = array_values(array_filter(
                array_map(fn($c) => ChartData::sanitizeColor($c), $data->colors)
            ));
        } else {
            $seriesColors = array_values(array_filter(
                array_map(fn($s) => ChartData::sanitizeColor($s['color'] ?? null), $data->series)
            ));
            if (!empty($seriesColors)) {
                $config['colors'] = $seriesColors;
            }
        }

        $config['legend'] = [
            'show' => $data->legend['enabled'] ?? true,
            'position' => $data->legend['position'] ?? 'bottom',
        ];

        $config['tooltip'] = [
            'enabled' => $data->tooltip['enabled'] ?? true,
            'shared' => $data->tooltip['shared'] ?? false,
        ];

        $config['dataLabels'] = ['enabled' => false];

        // Store prefix/suffix as private keys for renderHtml()
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

        $prefix     = $config['_valuePrefix'] ?? '';
        $suffix     = $config['_valueSuffix'] ?? '';
        $yAxisSuffix = $config['_yAxisSuffix'] ?? '';
        unset($config['_valuePrefix'], $config['_valueSuffix'], $config['_yAxisSuffix']);

        $jsonConfig = Json::encode($config);

        $html = sprintf(
            '<div id="%s" style="width:%s;height:%s;" class="%s"></div>',
            htmlspecialchars($containerId),
            htmlspecialchars($width),
            htmlspecialchars($height),
            htmlspecialchars($class)
        );

        $formatterJs = '';
        if ($prefix !== '' || $suffix !== '') {
            $p = json_encode($prefix);
            $s = json_encode($suffix);
            $formatterJs = "var _p={$p},_s={$s};" .
                "config.tooltip=config.tooltip||{};" .
                "config.tooltip.y={formatter:function(val){return _p+val+_s;}};" .
                "if(config.yaxis){config.yaxis.labels=config.yaxis.labels||{};config.yaxis.labels.formatter=function(val){return _p+val+_s;};}";
        } elseif ($yAxisSuffix !== '') {
            $ys = json_encode($yAxisSuffix);
            $formatterJs = "var _ys={$ys};" .
                "if(config.yaxis){config.yaxis.labels=config.yaxis.labels||{};config.yaxis.labels.formatter=function(val){return val+_ys;};}";
        }

        $initScript = '(function(){';
        $initScript .= sprintf('if(typeof ApexCharts==="undefined"){console.warn("Chart Field: ApexCharts JS not loaded.");return;}');
        $initScript .= sprintf('var config=%s;', $jsonConfig);
        $initScript .= $formatterJs;
        $initScript .= sprintf('var chart=new ApexCharts(document.getElementById(%s),config);', json_encode($containerId));
        $initScript .= 'chart.render();';
        $initScript .= '})();';

        $html .= sprintf('<script>%s</script>', $initScript);

        return $html;
    }

    // --- Private helpers ---

    private function mapChartType(string $type): string
    {
        return match ($type) {
            'column', 'stacked-column' => 'bar',
            'bar', 'stacked-bar' => 'bar',
            'area', 'stacked-area' => 'area',
            'donut' => 'donut',
            default => $type,
        };
    }
}
