<?php

namespace chartfield\fields;

use Craft;
use craft\base\ElementInterface;
use craft\base\Field;
use craft\helpers\Html;
use craft\helpers\Json;
use chartfield\assets\FieldInputAsset;
use chartfield\assets\FieldSettingsAsset;
use chartfield\models\ChartData;
use chartfield\Plugin;

class ChartField extends Field
{
    // --- Field Settings ---

    /** Charting library handle: 'chartjs' | 'highcharts' | 'apexcharts' */
    public string $chartLibrary = 'chartjs';

    /** Allowed chart types for content authors — subset of all types */
    public array $allowedChartTypes = ['line', 'bar', 'column', 'pie'];

    /** Default color palette handle */
    public string $defaultPalette = 'default';

    /** Whether to show per-series color pickers */
    public bool $allowCustomColors = true;

    /** Whether to show the advanced styling panel (legend, tooltip, credits) */
    public bool $showAdvancedOptions = false;

    /** Whether to show the live chart preview in CP */
    public bool $showLivePreview = true;

    public static function displayName(): string
    {
        return Craft::t('chart-field', 'Chart');
    }

    public static function icon(): string
    {
        return 'chart-line';
    }

    public function getSettingsHtml(): ?string
    {
        $view = Craft::$app->getView();
        $view->registerAssetBundle(FieldSettingsAsset::class);

        $registry = Plugin::getInstance()->rendererRegistry;
        $renderer = $registry->get($this->chartLibrary);
        $showLicenseWarning = $renderer?->isCommercial() && !$registry->hasLicenseKey($this->chartLibrary);

        return $view->renderTemplate('chart-field/_fields/settings', [
            'field' => $this,
            'libraryOptions' => $registry->getOptions(),
            'allTypes' => $this->getAllChartTypesForLibrary($this->chartLibrary),
            'showLicenseWarning' => $showLicenseWarning,
            'paletteOptions' => $this->getPaletteOptions(),
        ]);
    }

    public function getInputHtml(mixed $value, ?ElementInterface $element = null): string
    {
        $view = Craft::$app->getView();
        $view->registerAssetBundle(FieldInputAsset::class);

        $existingJson = '';
        if ($value instanceof ChartData) {
            $existingJson = Json::encode($value->serializeToArray());
        }

        $registry = Plugin::getInstance()->rendererRegistry;
        $renderer = $registry->get($this->chartLibrary);
        $showLicenseWarning = $renderer?->isCommercial() && !$registry->hasLicenseKey($this->chartLibrary);

        $previewJsAssets = $this->showLivePreview && $renderer
            ? $registry->getJsAssets($this->chartLibrary)
            : [];

        return $view->renderTemplate('chart-field/_fields/input', [
            'field' => $this,
            'name' => $this->handle,
            'existingJson' => $existingJson,
            'allowedChartTypes' => $this->allowedChartTypes,
            'allowCustomColors' => $this->allowCustomColors,
            'showAdvancedOptions' => $this->showAdvancedOptions,
            'showLicenseWarning' => $showLicenseWarning,
            'defaultPalette' => $this->getPalettes()[$this->defaultPalette] ?? array_values($this->getPalettes())[0],
            'showLivePreview' => $this->showLivePreview,
            'chartLibrary' => $this->chartLibrary,
            'previewJsAssets' => $previewJsAssets,
            'previewNoLicense' => $renderer?->isCommercial() && !$registry->hasLicenseKey($this->chartLibrary),
        ]);
    }

    public function normalizeValue(mixed $value, ?ElementInterface $element = null): mixed
    {
        if ($value instanceof ChartData) {
            return $value;
        }

        if (is_string($value) && $value !== '') {
            $decoded = Json::decodeIfJson($value);
            if (is_array($decoded)) {
                $chartData = new ChartData($decoded);
                $chartData->normalizeAxes();
                $chartData->setField($this);
                return $chartData;
            }
        }

        if (is_array($value) && !empty($value)) {
            $chartData = new ChartData($value);
            $chartData->normalizeAxes();
            $chartData->setField($this);
            return $chartData;
        }

        return null;
    }

    public function serializeValue(mixed $value, ?ElementInterface $element = null): mixed
    {
        if ($value instanceof ChartData) {
            return Json::encode($value->serializeToArray());
        }

        return null;
    }

    public function getElementValidationRules(): array
    {
        return [];
    }

    public static function dbType(): array|string|null
    {
        return \yii\db\Schema::TYPE_TEXT;
    }

    // --- Private helpers ---

    private function getAllChartTypesForLibrary(string $library): array
    {
        $registry = Plugin::getInstance()->rendererRegistry;
        $renderer = $registry->get($library);
        return $renderer?->getSupportedTypes() ?? [];
    }

    private function getPalettes(): array
    {
        return Plugin::getInstance()->getSettings()->palettes;
    }

    private function getPaletteOptions(): array
    {
        $options = [];
        foreach ($this->getPalettes() as $handle => $colors) {
            $options[] = ['label' => ucfirst($handle), 'value' => $handle];
        }
        return $options;
    }
}
