import tempfile
import unittest
import json
import re
from pathlib import Path
from unittest.mock import patch
import pandas as pd
from src.aml_graph import load_data, aggregate_relations, build_graph, detect_communities
from generar_html import build_payload, generate, parse_nodes


class PipelineTests(unittest.TestCase):
    def make(self, content):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / 'input.csv'
        path.write_text(content, encoding='utf-8')
        return path

    def test_four_optional_combinations(self):
        for suffix, values, expect in [('', '', (False, False)), (',codmes', ',202501', (True, False)),
                                      (',canal', ',APP', (False, True)), (',codmes,canal', ',202501,APP', (True, True))]:
            with self.subTest(expect=expect):
                p = build_payload(self.make('origen,destino,suma_monto,ctd_trx'+suffix+'\n001,002,12,2'+values+'\n'))
                self.assertEqual((bool(p['monthly']), bool(p['channels'])), expect)
                self.assertEqual(p['persons'][0]['persona'] in ('001', '002'), True)
                self.assertEqual(p['summary']['amount'], 12)

    def test_empty_optional_and_zero_amount(self):
        p = build_payload(self.make('origen,destino,suma_monto,ctd_trx,codmes,canal\nA,B,0,1,,\n'))
        self.assertEqual(p['schema'], {'codmes': None, 'canal': None})
        self.assertEqual(len(p['communities']), 1)

    def test_aliases_and_reciprocal_aggregation(self):
        path = self.make('origen,destino,suma de monto,ctd trx\nA,B,4,1\nA,B,6,1\nB,A,7,2\n')
        # Public spreadsheet headers are supported as aliases.
        frame, schema = load_data(path)
        g = build_graph(aggregate_relations(frame, schema))
        self.assertEqual(g['A']['B']['suma_monto'], 10)
        self.assertEqual(g['B']['A']['suma_monto'], 7)
        self.assertEqual(sum(d['suma_monto'] for _,_,d in g.edges(data=True)), 17)
        self.assertEqual(len(detect_communities(g)[1]), 1)

    def test_reject_invalid_values_without_silent_zero(self):
        for amount, count in [('bad','1'), ('-1','1'), ('inf','1'), ('3','1.5'), ('3','0')]:
            with self.subTest(amount=amount,count=count), self.assertRaises(ValueError):
                load_data(self.make(f'origen,destino,suma_monto,ctd_trx\nA,B,{amount},{count}\n'))

    def test_identifier_null_and_month_format(self):
        for content in ['origen,destino,suma_monto,ctd_trx\n,B,3,1\n',
                        'origen,destino,suma_monto,ctd_trx,codmes\nA,B,3,1,202513\n']:
            with self.assertRaises(ValueError):
                load_data(self.make(content))

    def test_self_loop_and_empty_dataset(self):
        for tail in ['', 'A,A,0,1\n']:
            p = build_payload(self.make('origen,destino,suma_monto,ctd_trx\n'+tail))
            self.assertEqual(len(p['strong_components']),0)

    def test_safe_self_contained_generation(self):
        path = self.make('origen,destino,suma_monto,ctd_trx\n</script><img>,__CORE__,4,1\n')
        output = generate(path, path.parent / 'report.html')
        html = output.read_text(encoding='utf-8')
        self.assertIn(r'\u003c/script>', html)
        self.assertNotIn('<script src=', html)
        self.assertNotIn('Patrones AML', html)
        self.assertNotIn('Las señales priorizan revisión', html)
        payload = json.loads(re.search(r'id="payload">(.*?)</script>', html, re.S)[1])
        self.assertIn('__CORE__', [p['persona'] for p in payload['persons']])
        self.assertTrue((path.parent/'documentacion_proyecto.html').exists())

    def test_partial_optional_dimensions_preserve_historical_totals(self):
        path = self.make('origen,destino,suma_monto,ctd_trx,codmes,canal\nA,B,10,1,202501,\nA,B,20,2,,APP\n')
        p = build_payload(path)
        self.assertEqual(p['summary']['amount'], 30)
        self.assertEqual(p['edges'][0]['suma_monto'], 30)
        self.assertEqual(p['monthly'][0]['monto'], 10)
        self.assertEqual(p['channels'][0]['monto'], 20)
        self.assertEqual(len(p['relations']), 2)

    def test_chunked_node_filter_keeps_incident_edges(self):
        path = self.make('origen,destino,suma_monto,ctd_trx\nA,B,10,1\nB,C,20,2\nX,Y,99,3\n')
        p = build_payload(path, nodes={'B'}, chunksize=1)
        self.assertEqual(p['summary']['amount'], 30)
        self.assertEqual({row['persona'] for row in p['persons']}, {'A', 'B', 'C'})

    def test_multihop_extraction_is_bounded_and_does_not_duplicate_rows(self):
        path = self.make('origen,destino,suma_monto,ctd_trx\nA,B,10,1\nB,C,20,2\nC,D,30,3\nD,E,40,4\nX,Y,99,9\n')
        p = build_payload(path, nodes={'A'}, chunksize=1, extract_depth=2)
        self.assertEqual({row['persona'] for row in p['persons']}, {'A', 'B', 'C'})
        self.assertEqual(p['summary']['amount'], 30)
        self.assertEqual(p['meta']['extract_depth'], 2)

    def test_interpretable_local_metrics(self):
        path = self.make('origen,destino,suma_monto,ctd_trx\nA,B,10,1\nB,A,5,1\nC,A,5,1\n')
        p = build_payload(path)
        a = next(row for row in p['persons'] if row['persona'] == 'A')
        self.assertEqual(a['contrapartes_unicas'], 2)
        self.assertAlmostEqual(a['equilibrio_flujo'], 1.0)
        self.assertAlmostEqual(a['reciprocidad'], .5)
        self.assertAlmostEqual(a['hhi_entrada'], .5)

    def test_generation_writes_persistent_checkpoints(self):
        path = self.make('origen,destino,suma_monto,ctd_trx\nA,B,4,1\n')
        output = generate(path, path.parent / 'report.html')
        log = output.with_suffix('.log').read_text(encoding='utf-8')
        self.assertIn('carga y validación completas', log)
        self.assertIn('archivos escritos', log)

    def test_large_csv_requires_scope_before_loading(self):
        path = self.make('origen,destino,suma_monto,ctd_trx\nA,B,4,1\n')
        with patch('src.aml_graph.LARGE_FILE_BYTES', 1), self.assertRaisesRegex(ValueError, 'supera 3 GiB'):
            load_data(path)
        with patch('src.aml_graph.LARGE_FILE_BYTES', 1):
            frame, _ = load_data(path, nodes={'A'})
        self.assertEqual(len(frame), 1)

    def test_parse_nodes_from_argument_and_file(self):
        path = self.make('A\nB; C\n')
        self.assertEqual(parse_nodes('D,E', str(path)), {'A', 'B', 'C', 'D', 'E'})


if __name__ == '__main__':
    unittest.main()
