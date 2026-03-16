<?php

namespace chartfield\models;

use Craft;
use craft\base\Model;
use craft\helpers\Json;
use chartfield\fields\ChartField;
use chartfield\Plugin;

class ChartData extends Model
{
    // Canonical schema properties
    public ?string $chartType = null;
    public ?string $title = null;
    public ?string $subtitle = null;
    public ?array $xAxis = null;
    public ?array $yAxis = null;
    public array $series = [];
    public ?array $legend = null;
    public ?array $colors = null;
    public ?array $tooltip = null;
    public bool $credits = false;
    public bool $responsive = true;
    public bool $stacking = false;
    public ?string $valuePrefix = null;
    public ?string $valueSuffix = null;
    public string $inputMode = 'spreadsheet';

    private ?ChartField $_field = null;

    public function setField(ChartField $field): void
    {
        $this->_field = $field;
    }

    public function getField(): ?ChartField
    {
        return $this->_field;
    }

    /**
     * Returns the library-specific config array using the renderer
     * determined by the field's chartLibrary setting.
     */
    public function getChartConfig(): array
    {
        $plugin = Plugin::getInstance();
        $library = $this->_field?->chartLibrary ?? 'chartjs';
        $renderer = $plugin->rendererRegistry->get($library);

        if (!$renderer) {
            return [];
        }

        $licenseKey = $renderer->isCommercial()
            ? $plugin->rendererRegistry->getLicenseKey($library)
            : null;

        return $renderer->buildConfig($this, $licenseKey);
    }

    /**
     * Returns the library-specific config as a JSON string.
     * Ready to be injected into a <script> tag via |raw filter.
     */
    public function getJson(): string
    {
        return Json::encode($this->getChartConfig());
    }

    /**
     * Renders a complete HTML snippet: container element + <script> that
     * initializes the chart. Respects plugin settings for autoLoadJs and
     * CDN overrides. Injects license key for commercial libraries.
     *
     * @param array $options Optional overrides: 'id', 'class', 'width', 'height'
     */
    public function render(array $options = []): \Twig\Markup
    {
        $plugin = Plugin::getInstance();
        $library = $this->_field?->chartLibrary ?? 'chartjs';
        $renderer = $plugin->rendererRegistry->get($library);

        if (!$renderer) {
            return new \Twig\Markup('', 'UTF-8');
        }

        $containerId = $options['id'] ?? ('chart-' . uniqid());
        $licenseKey = $renderer->isCommercial()
            ? $plugin->rendererRegistry->getLicenseKey($library)
            : null;

        $settings = $plugin->getSettings();
        $jsAssets = [];

        if ($settings->autoLoadJs) {
            $jsAssets = $plugin->rendererRegistry->getJsAssets($library);
            $view = Craft::$app->getView();
            foreach ($jsAssets as $url) {
                $view->registerJsFile($url, ['position' => \yii\web\View::POS_HEAD]);
            }
        }

        $config = $renderer->buildConfig($this, $licenseKey);
        $html = $renderer->renderHtml($containerId, $config, $options, $jsAssets, $licenseKey);

        return new \Twig\Markup($html, 'UTF-8');
    }

    /**
     * Returns the resolved CDN URL(s) for the charting library.
     * Respects CDN overrides from plugin settings.
     */
    public function getJsAssets(): array
    {
        $library = $this->_field?->chartLibrary ?? 'chartjs';
        return Plugin::getInstance()->rendererRegistry->getJsAssets($library);
    }

    /**
     * Returns the value if it is a valid CSS hex color, otherwise null.
     * Accepts 3- or 6-digit hex colors with a leading #.
     */
    public static function sanitizeColor(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        return preg_match('/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/', $value) ? $value : null;
    }

    /**
     * Converts the model back to the canonical array format for JSON storage.
     */
    public function serializeToArray(): array
    {
        return array_filter([
            'chartType' => $this->chartType,
            'title' => $this->title,
            'subtitle' => $this->subtitle,
            'xAxis' => $this->xAxis,
            'yAxis' => $this->yAxis,
            'series' => $this->series,
            'legend' => $this->legend,
            'colors' => $this->colors,
            'tooltip' => $this->tooltip,
            'credits' => $this->credits,
            'responsive' => $this->responsive,
            'stacking' => $this->stacking,
            'valuePrefix' => $this->valuePrefix,
            'valueSuffix' => $this->valueSuffix,
            'inputMode' => $this->inputMode,
        ], fn($v) => $v !== null);
    }

    public function defineRules(): array
    {
        $allTypes = ['line', 'bar', 'column', 'area', 'pie', 'donut', 'doughnut', 'scatter', 'radar', 'polar-area', 'heatmap', 'stacked-bar', 'stacked-column', 'stacked-area', 'polar'];

        return [
            [['chartType'], 'required'],
            [['chartType'], 'in', 'range' => $allTypes],
            [['title', 'subtitle'], 'string', 'max' => 200],
            [['series'], 'required'],
            [['series'], 'validateSeries'],
            [['responsive', 'credits', 'stacking'], 'boolean'],
        ];
    }

    public function validateSeries(): void
    {
        if (empty($this->series)) {
            $this->addError('series', 'At least one series is required.');
            return;
        }

        $isPieType = in_array($this->chartType, ['pie', 'donut', 'doughnut']);

        foreach ($this->series as $i => $series) {
            if (empty($series['name'])) {
                $this->addError('series', "Series $i is missing a name.");
            }
            if (empty($series['data'])) {
                $this->addError('series', "Series $i has no data.");
                continue;
            }
            if ($isPieType) {
                foreach ($series['data'] as $j => $item) {
                    if (!isset($item['name']) || !isset($item['value'])) {
                        $this->addError('series', "Pie series item $j must have 'name' and 'value'.");
                    }
                }
            }
        }

        // Validate categories length matches series data length for category axes
        if (
            !$isPieType &&
            !empty($this->xAxis['categories']) &&
            !empty($this->series[0]['data'])
        ) {
            $catCount = count($this->xAxis['categories']);
            foreach ($this->series as $i => $series) {
                $dataCount = count($series['data'] ?? []);
                if ($dataCount > 0 && $dataCount !== $catCount) {
                    $this->addError('series', "Series $i has $dataCount data points but $catCount categories are defined.");
                }
            }
        }
    }
}
