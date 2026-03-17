<?php

namespace chartfield\services;

use Craft;
use craft\base\Component;
use chartfield\renderers\ApexChartsRenderer;
use chartfield\renderers\ChartJsRenderer;
use chartfield\renderers\ChartRendererInterface;
use chartfield\renderers\HighchartsRenderer;
use chartfield\Plugin;

class RendererRegistry extends Component
{
    private array $_renderers = [];

    public function init(): void
    {
        parent::init();

        $this->register(new ChartJsRenderer());
        $this->register(new HighchartsRenderer());
        $this->register(new ApexChartsRenderer());
    }

    public function register(ChartRendererInterface $renderer): void
    {
        $this->_renderers[$renderer->getHandle()] = $renderer;
    }

    public function get(string $handle): ?ChartRendererInterface
    {
        return $this->_renderers[$handle] ?? null;
    }

    public function getAll(): array
    {
        return $this->_renderers;
    }

    /** Returns options array for a <select> dropdown */
    public function getOptions(): array
    {
        return array_values(array_map(fn($r) => [
            'label' => $r->getName() . ($r->isCommercial() ? ' (commercial)' : ''),
            'value' => $r->getHandle(),
        ], $this->_renderers));
    }

    /**
     * Resolves the license key for a given renderer handle.
     * Reads from plugin settings and parses environment variables.
     */
    public function getLicenseKey(string $handle): ?string
    {
        $settings = Plugin::getInstance()->getSettings();
        $raw = $settings->licenseKeys[$handle] ?? null;

        if ($raw === null || $raw === '') {
            return null;
        }

        return Craft::parseEnv($raw);
    }

    /**
     * Resolves the JS asset URLs for a given renderer.
     * Checks for CDN overrides in plugin settings, falls back to defaults.
     */
    public function getJsAssets(string $handle): array
    {
        $settings = Plugin::getInstance()->getSettings();
        $renderer = $this->get($handle);

        if (!$renderer) {
            return [];
        }

        $override = $settings->cdnOverrides[$handle] ?? null;
        if ($override) {
            $url = Craft::parseEnv($override);
            // Only allow absolute http/https URLs to prevent javascript: or data: injection
            if (is_string($url) && preg_match('#^https?://#i', $url)) {
                return [$url];
            }
        }

        return $renderer->getDefaultJsAssets();
    }

    /**
     * Returns whether a license key is configured for the given renderer handle.
     */
    public function hasLicenseKey(string $handle): bool
    {
        return $this->getLicenseKey($handle) !== null;
    }

    /**
     * Returns resolved JS URLs for all enabled Highcharts modules.
     * Respects per-module CDN overrides from plugin settings.
     */
    public function getHighchartsModuleJsAssets(): array
    {
        $settings = Plugin::getInstance()->getSettings();
        $enabledModules = $settings->highchartsModules;
        $overrides = $settings->highchartsModuleCdnOverrides;
        $availableModules = HighchartsRenderer::getAvailableModules();

        $urls = [];
        foreach ($enabledModules as $moduleHandle) {
            if (!isset($availableModules[$moduleHandle])) {
                continue;
            }
            $override = $overrides[$moduleHandle] ?? null;
            if ($override) {
                $url = Craft::parseEnv($override);
                if (is_string($url) && preg_match('#^https?://#i', $url)) {
                    $urls[] = $url;
                    continue;
                }
            }
            $urls[] = $availableModules[$moduleHandle]['url'];
        }

        return $urls;
    }
}
