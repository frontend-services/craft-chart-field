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
        $isCombo = $this->isComboMode($data);
        $isPolar = in_array($chartType, ['pie', 'donut']);
        $isStacked = in_array($chartType, ['stacked-bar', 'stacked-column', 'stacked-area']) || $data->stacking;

        // In combo mode ApexCharts requires chart.type to be the type of the
        // first series (it uses it as the "base" renderer for the axes).
        $baseType = $isCombo
            ? $this->mapChartType(!empty($data->series[0]['type']) ? $data->series[0]['type'] : $chartType)
            : $this->mapChartType($chartType);

        $config = [
            'chart' => [
                'type' => $baseType,
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

        $yAxes = $data->getResolvedYAxes();

        if ($isPolar) {
            $firstSeries = $data->series[0] ?? [];
            $config['series'] = array_column($firstSeries['data'] ?? [], 'value');
            $config['labels'] = array_column($firstSeries['data'] ?? [], 'name');
        } else {
            $config['series'] = array_map(function ($s) use ($chartType, $isCombo) {
                $entry = [
                    'name' => $s['name'] ?? '',
                    'data' => $s['data'] ?? [],
                ];
                if ($isCombo) {
                    $seriesType = !empty($s['type']) ? $s['type'] : $chartType;
                    $entry['type'] = $this->mapChartType($seriesType);
                }
                return $entry;
            }, $data->series);

            $config['xaxis'] = [
                'title'      => ['text' => $data->xAxis['label'] ?? ''],
                'categories' => $data->xAxis['categories'] ?? [],
                'type'       => $chartType === 'scatter' ? 'numeric' : 'category',
            ];

            // Build yaxis array — one entry per series, grouped by shared axis
            $axisFirstSeriesName = [];
            foreach ($data->series as $s) {
                $axIdx = (int)($s['yAxisIndex'] ?? 0);
                if (!isset($axisFirstSeriesName[$axIdx])) {
                    $axisFirstSeriesName[$axIdx] = $s['name'] ?? '';
                }
            }

            $yaxisEntries = [];
            foreach ($data->series as $s) {
                $axIdx     = (int)($s['yAxisIndex'] ?? 0);
                $ax        = $yAxes[$axIdx] ?? $yAxes[0] ?? [];
                $firstName = $axisFirstSeriesName[$axIdx] ?? '';
                $isFirst   = ($s['name'] ?? '') === $firstName;

                if ($isFirst) {
                    $entry = [
                        'title'    => ['text' => $ax['label'] ?? ''],
                        'opposite' => $axIdx > 0,
                    ];
                    if (isset($ax['min']) && $ax['min'] !== null) $entry['min'] = $ax['min'];
                    if (isset($ax['max']) && $ax['max'] !== null) $entry['max'] = $ax['max'];
                } else {
                    $entry = [
                        'show'       => false,
                        'seriesName' => $firstName,
                    ];
                }
                $yaxisEntries[] = $entry;
            }

            // Single series + single axis: use plain object (cleaner config)
            $config['yaxis'] = count($yaxisEntries) === 1 ? $yaxisEntries[0] : $yaxisEntries;

            // Per-series formatters (prefix/suffix) — stored as private key for renderHtml()
            $perSeriesFormatters = array_map(function ($s) use ($yAxes) {
                $axIdx = (int)($s['yAxisIndex'] ?? 0);
                $ax    = $yAxes[$axIdx] ?? $yAxes[0] ?? [];
                return [
                    'prefix' => $ax['prefix'] ?? '',
                    'suffix' => $ax['suffix'] ?? '',
                ];
            }, $data->series);

            $hasFormatters = !empty(array_filter(
                $perSeriesFormatters,
                fn($f) => $f['prefix'] !== '' || $f['suffix'] !== ''
            ));
            if ($hasFormatters) {
                $config['_perSeriesFormatters'] = array_values($perSeriesFormatters);
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

        $formatters = $config['_perSeriesFormatters'] ?? [];
        unset($config['_perSeriesFormatters']);

        $jsonConfig = Json::encode($config);

        $html = sprintf(
            '<div id="%s" style="width:%s;height:%s;" class="%s"></div>',
            htmlspecialchars($containerId),
            htmlspecialchars($width),
            htmlspecialchars($height),
            htmlspecialchars($class)
        );

        $formatterJs = '';
        if (!empty($formatters)) {
            $fmtJson     = json_encode(array_values($formatters));
            $formatterJs =
                "var _pf={$fmtJson};" .
                "config.tooltip=config.tooltip||{};" .
                "config.tooltip.y=_pf.map(function(f){return{formatter:function(val){return (f.prefix||'')+val+(f.suffix||'');}}; });" .
                "var _ya=Array.isArray(config.yaxis)?config.yaxis:(config.yaxis?[config.yaxis]:[]);" .
                "var _afSeen={};" .
                "(config.series||[]).forEach(function(s,i){" .
                "var e=_ya[i];if(!e||e.seriesName)return;" .
                "var f=_pf[i]||{prefix:'',suffix:''};" .
                "if(!_afSeen[s.name]&&(f.prefix||f.suffix)){" .
                "_afSeen[s.name]=true;" .
                "e.labels=e.labels||{};" .
                "(function(p,sf){e.labels.formatter=function(val){return p+val+sf;};})(f.prefix||'',f.suffix||'');" .
                "}" .
                "});";
        }

        $initScript  = '(function(){';
        $initScript .= 'if(typeof ApexCharts==="undefined"){console.warn("Chart Field: ApexCharts JS not loaded.");return;}';
        $initScript .= sprintf('var config=%s;', $jsonConfig);
        $initScript .= $formatterJs;
        $initScript .= sprintf('var chart=new ApexCharts(document.getElementById(%s),config);', json_encode($containerId));
        $initScript .= 'chart.render();';
        $initScript .= '})();';

        $html .= sprintf('<script>%s</script>', $initScript);

        return $html;
    }

    // --- Private helpers ---

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
