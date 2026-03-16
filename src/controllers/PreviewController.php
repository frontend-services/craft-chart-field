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

        $stateJson   = $this->request->getBodyParam('state', '{}');
        $libraryHandle = $this->request->getBodyParam('library', 'chartjs');

        $stateData = json_decode($stateJson, true);
        if (!is_array($stateData)) {
            return $this->asJson(['error' => 'Invalid state']);
        }

        $chartData = new ChartData($stateData);

        $registry = Plugin::getInstance()->rendererRegistry;
        $renderer = $registry->get($libraryHandle);

        if (!$renderer) {
            return $this->asJson(['error' => 'Unknown renderer: ' . $libraryHandle]);
        }

        $licenseKey = $renderer->isCommercial() ? $registry->getLicenseKey($libraryHandle) : null;
        $config     = $renderer->buildConfig($chartData, $licenseKey);

        // Strip PHP-only rendering hints before sending to JS
        unset($config['_valuePrefix'], $config['_valueSuffix'], $config['_yAxisSuffix']);

        return $this->asJson([
            'config'  => $config,
            'library' => $libraryHandle,
        ]);
    }
}
