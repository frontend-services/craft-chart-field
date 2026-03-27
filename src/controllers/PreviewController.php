<?php

namespace chartfield\controllers;

use Craft;
use craft\web\Controller;
use chartfield\models\ChartData;
use chartfield\Plugin;
use yii\web\Response;

class PreviewController extends Controller
{
    protected array|bool|int $allowAnonymous = false;

    public function actionRender(): Response
    {
        $this->requirePostRequest();

        $stateJson     = $this->request->getBodyParam('state', '{}');
        $libraryHandle = $this->request->getBodyParam('library', 'chartjs');

        $registry = Plugin::getInstance()->rendererRegistry;

        // Whitelist the library handle against registered renderers before any further use
        $renderer = $registry->get($libraryHandle);
        if (!$renderer) {
            return $this->asJson(['error' => 'Invalid library']);
        }

        $stateData = json_decode($stateJson, true);
        if (!is_array($stateData)) {
            return $this->asJson(['error' => 'Invalid state']);
        }

        $chartData = new ChartData($stateData);

        $licenseKey = $renderer->isCommercial() ? $registry->getLicenseKey($libraryHandle) : null;
        $config     = $renderer->buildConfig($chartData, $licenseKey);

        // Strip PHP-only rendering hints before sending to JS
        unset($config['_yAxesFormatters'], $config['_perSeriesFormatters']);

        return $this->asJson([
            'config'  => $config,
            'library' => $libraryHandle,
        ]);
    }
}
