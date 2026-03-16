<?php

namespace chartfield;

use Craft;
use craft\base\Model;
use craft\base\Plugin as BasePlugin;
use craft\events\RegisterComponentTypesEvent;
use craft\services\Fields;
use chartfield\fields\ChartField;
use chartfield\models\Settings;
use chartfield\services\RendererRegistry;
use yii\base\Event;

/**
 * Chart Field plugin for Craft CMS.
 *
 * @property RendererRegistry $rendererRegistry
 * @property Settings $settings
 */
class Plugin extends BasePlugin
{
    public bool $hasCpSettings = true;

    public string $schemaVersion = '1.0.0';

    public static function config(): array
    {
        return [
            'components' => [
                'rendererRegistry' => RendererRegistry::class,
            ],
        ];
    }

    public function init(): void
    {
        parent::init();

        Event::on(
            Fields::class,
            Fields::EVENT_REGISTER_FIELD_TYPES,
            function (RegisterComponentTypesEvent $event) {
                $event->types[] = ChartField::class;
            }
        );
    }

    protected function createSettingsModel(): ?Model
    {
        return new Settings();
    }

    protected function settingsHtml(): ?string
    {
        $renderers = $this->rendererRegistry->getAll();

        return Craft::$app->view->renderTemplate('chart-field/_settings/index', [
            'settings' => $this->getSettings(),
            'renderers' => $renderers,
        ]);
    }
}
